/**
 * Peekaboo backend for termless.
 *
 * Combines a headless xterm.js backend (for data) with a real terminal app
 * (for visual verification). Data methods delegate to the xterm backend.
 * Visual methods launch a terminal app and take screenshots via screencapture.
 *
 * Architecture:
 * 1. A real terminal app is launched running the command (for screenshots)
 * 2. A separate PTY process runs the same command, piping output to xterm.js (for data)
 * 3. takeScreenshot() captures the real terminal app for visual comparison
 *
 * IMPORTANT: Steps 1 and 2 are separate OS processes. The visual screenshot and
 * the xterm.js data come from different process instances and may diverge. See
 * the createPeekabooBackend() JSDoc for details and implications.
 *
 * The "data path" (getText, getCell, etc.) uses xterm.js for speed/accuracy.
 * The "visual path" (takeScreenshot) uses the real terminal for fidelity.
 */

import { createXtermBackend } from "../../xtermjs/src/backend.ts"
import { spawnPty, type PtyHandle } from "../../../src/pty.ts"
import { exec, execDetached, readFileAsBuffer } from "./exec.ts"
import type {
  TerminalBackend,
  TerminalOptions,
  Cell,
  CursorState,
  KeyDescriptor,
  TerminalMode,
  ScrollbackState,
  TerminalCapabilities,
} from "../../../src/types.ts"

// ═══════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════

export type TerminalApp = "ghostty" | "iterm2" | "terminal" | "wezterm" | "kitty"

export interface PeekabooOptions {
  /** Terminal app to use for visual verification. Default: "ghostty" */
  app?: TerminalApp
  /** Whether to launch the terminal app for visual verification. Default: false */
  visual?: boolean
  scrollbackLimit?: number
}

export interface PeekabooBackend extends TerminalBackend {
  /** Take a real screenshot of the terminal app window (returns PNG buffer). Requires visual=true. */
  takeScreenshot(): Promise<Buffer>
  /** Spawn a command in the PTY, feeding output to both xterm.js and the real terminal. */
  spawnCommand(command: string[], opts?: { env?: Record<string, string>; cwd?: string }): Promise<PtyHandle>
  /** The terminal app being used for visual verification (null if visual=false). */
  readonly terminalApp: TerminalApp | null
  /** Whether a real terminal app is attached for visual verification. */
  readonly visualActive: boolean
  /** PID of the terminal app window process (null if not launched). */
  readonly appPid: number | null
}

// ═══════════════════════════════════════════════════════
// Terminal app launchers (macOS)
// ═══════════════════════════════════════════════════════

/** Map of terminal app names to their macOS application bundle names */
const APP_BUNDLE_NAMES: Record<TerminalApp, string> = {
  ghostty: "Ghostty",
  iterm2: "iTerm",
  terminal: "Terminal",
  wezterm: "WezTerm",
  kitty: "kitty",
}

/** Launch a terminal app with a command. Returns the app process. */
async function launchTerminalApp(
  app: TerminalApp,
  command: string[],
  opts?: { env?: Record<string, string>; cwd?: string },
): Promise<{ pid: number; close: () => Promise<void> }> {
  const cmd = command.map((arg) => `'${arg.replace(/'/g, "'\\''")}'`).join(" ")
  const cwd = opts?.cwd ?? process.cwd()

  // Build env export string for the shell command
  const envExports = opts?.env
    ? Object.entries(opts.env)
        .map(([k, v]) => `export ${k}=${JSON.stringify(v)}`)
        .join("; ")
    : ""
  const fullCmd = envExports ? `${envExports}; cd ${JSON.stringify(cwd)}; ${cmd}` : `cd ${JSON.stringify(cwd)}; ${cmd}`

  let handle: { pid: number; exited: Promise<number> }

  switch (app) {
    case "ghostty": {
      // Ghostty supports --command flag
      handle = execDetached(["open", "-a", "Ghostty", "--args", "-e", fullCmd])
      break
    }
    case "iterm2": {
      // Use osascript to tell iTerm2 to create a new window with the command
      const script = `
        tell application "iTerm2"
          create window with default profile command "${fullCmd.replace(/"/g, '\\"')}"
        end tell
      `
      handle = execDetached(["osascript", "-e", script])
      break
    }
    case "terminal": {
      // macOS Terminal.app
      const script = `
        tell application "Terminal"
          do script "${fullCmd.replace(/"/g, '\\"')}"
          activate
        end tell
      `
      handle = execDetached(["osascript", "-e", script])
      break
    }
    case "wezterm": {
      handle = execDetached(["open", "-a", "WezTerm", "--args", "start", "--", "bash", "-c", fullCmd])
      break
    }
    case "kitty": {
      handle = execDetached(["open", "-a", "kitty", "--args", "bash", "-c", fullCmd])
      break
    }
  }

  // Wait briefly for the app to launch
  await new Promise((resolve) => setTimeout(resolve, 1000))

  return {
    pid: handle.pid,
    async close() {
      // Try graceful close via osascript
      try {
        const bundleName = APP_BUNDLE_NAMES[app]
        const closeScript = `tell application "${bundleName}" to close front window`
        await exec(["osascript", "-e", closeScript])
      } catch {
        // Ignore close errors
      }
    },
  }
}

/** Capture a screenshot of a specific application window using screencapture (macOS). */
async function captureAppWindow(app: TerminalApp): Promise<Buffer> {
  const tmpPath = `/tmp/peekaboo-screenshot-${crypto.randomUUID()}.png`

  // Use screencapture with window selection by app name
  // First, get the window ID of the terminal app
  const bundleName = APP_BUNDLE_NAMES[app]
  const getWindowIdScript = `
    tell application "System Events"
      set appProc to first process whose name is "${bundleName}"
      set frontWindow to first window of appProc
      return id of frontWindow
    end tell
  `

  const windowIdResult = await exec(["osascript", "-e", getWindowIdScript], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const windowId = windowIdResult.stdout.trim()

  if (windowId && windowIdResult.exitCode === 0) {
    // Capture specific window by ID
    const captureResult = await exec(["screencapture", "-l", windowId, "-o", "-x", tmpPath], {
      stderr: "pipe",
    })
    if (captureResult.exitCode !== 0) {
      throw new Error(`screencapture failed with exit code ${captureResult.exitCode}: ${captureResult.stderr.trim()}`)
    }
  } else {
    // Fallback: capture the frontmost window
    // Bring the app to front first
    const activateScript = `tell application "${bundleName}" to activate`
    await exec(["osascript", "-e", activateScript])
    await new Promise((resolve) => setTimeout(resolve, 300))

    const captureResult = await exec(["screencapture", "-w", "-o", "-x", tmpPath], {
      stderr: "pipe",
    })
    if (captureResult.exitCode !== 0) {
      throw new Error(`screencapture failed with exit code ${captureResult.exitCode}: ${captureResult.stderr.trim()}`)
    }
  }

  // Read the screenshot file
  const buffer = await readFileAsBuffer(tmpPath)

  // Clean up temp file
  try {
    const { unlink } = await import("node:fs/promises")
    await unlink(tmpPath)
  } catch {
    // Ignore cleanup errors
  }

  return buffer
}

// ═══════════════════════════════════════════════════════
// Backend factory
// ═══════════════════════════════════════════════════════

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

/**
 * Create a peekaboo backend for termless.
 *
 * Wraps an xterm.js headless backend for data operations and optionally
 * launches a real terminal app for visual verification via screenshots.
 *
 * Data flow:
 *   PTY → xterm.js backend (headless, for getText/getCell/etc.)
 *   PTY → real terminal app (visual, for takeScreenshot)
 *
 * **Known limitation — dual-process divergence:**
 *
 * In visual mode, `spawnCommand()` starts TWO independent processes:
 * 1. `launchTerminalApp()` — opens a real terminal app running the command (for screenshots)
 * 2. `spawnPty()` — spawns a separate PTY feeding xterm.js (for data: getText, getCell, etc.)
 *
 * These are separate OS processes with independent state. The screenshot
 * (`takeScreenshot()`) captures the real terminal app, while data methods
 * (`getText()`, `getCell()`, etc.) read from the xterm.js backend. Because the
 * two processes run the same command independently, their output can diverge at
 * any moment — different timing, different random values, different interleaving.
 *
 * Implications for test authors:
 * - Do NOT assume that `getText()` content matches the screenshot pixel-perfectly.
 * - For deterministic comparisons, use either data methods OR screenshots, not both.
 * - Visual mode is best for human-in-the-loop verification, not automated assertions
 *   that cross-reference data and screenshots.
 * - Data-only mode (visual=false) uses a single process and is fully consistent.
 *
 * A future fix would pipe a single PTY's output to both xterm.js and the terminal
 * app, eliminating the dual-process issue.
 *
 * Usage:
 *   const backend = createPeekabooBackend({ visual: true, app: "ghostty" })
 *   backend.init({ cols: 80, rows: 24 })
 *   const pty = await backend.spawnCommand(["bun", "km"])
 *   await new Promise(r => setTimeout(r, 2000))
 *   const text = backend.getText()        // from xterm.js (PTY #2)
 *   const png = await backend.takeScreenshot()  // from real terminal (PTY #1, may differ!)
 */
export function createPeekabooBackend(opts?: PeekabooOptions): PeekabooBackend {
  const app = opts?.app ?? "ghostty"
  const visual = opts?.visual ?? false

  // Delegate data operations to xterm.js backend
  const xterm = createXtermBackend()

  let initialized = false
  let currentCols = DEFAULT_COLS
  let currentRows = DEFAULT_ROWS
  let appHandle: { pid: number; close: () => Promise<void> } | null = null

  // ── TerminalBackend: Lifecycle ──

  function init(options: TerminalOptions): void {
    xterm.init(options)
    currentCols = options.cols
    currentRows = options.rows
    initialized = true
  }

  function destroy(): void {
    xterm.destroy()
    if (appHandle) {
      void appHandle.close()
      appHandle = null
    }
    initialized = false
  }

  // ── TerminalBackend: Data flow (delegated to xterm) ──

  function feed(data: Uint8Array): void {
    xterm.feed(data)
  }

  function resize(cols: number, rows: number): void {
    currentCols = cols
    currentRows = rows
    xterm.resize(cols, rows)
  }

  function reset(): void {
    xterm.reset()
  }

  // ── TerminalBackend: Read operations (delegated to xterm) ──

  function getText(): string {
    return xterm.getText()
  }

  function getTextRange(startRow: number, startCol: number, endRow: number, endCol: number): string {
    return xterm.getTextRange(startRow, startCol, endRow, endCol)
  }

  function getCell(row: number, col: number): Cell {
    return xterm.getCell(row, col)
  }

  function getLine(row: number): Cell[] {
    return xterm.getLine(row)
  }

  function getLines(): Cell[][] {
    return xterm.getLines()
  }

  function getCursor(): CursorState {
    return xterm.getCursor()
  }

  function getMode(mode: TerminalMode): boolean {
    return xterm.getMode(mode)
  }

  function getTitle(): string {
    return xterm.getTitle()
  }

  function getScrollback(): ScrollbackState {
    return xterm.getScrollback()
  }

  function scrollViewport(delta: number): void {
    xterm.scrollViewport(delta)
  }

  function encodeKey(key: KeyDescriptor): Uint8Array {
    return xterm.encodeKey(key)
  }

  // ── Peekaboo: Spawn command ──

  async function spawnCommand(
    command: string[],
    spawnOpts?: { env?: Record<string, string>; cwd?: string },
  ): Promise<PtyHandle> {
    if (!initialized) throw new Error("Backend not initialized — call init() first")

    // Launch real terminal app if visual mode is enabled.
    // NOTE: This starts a SEPARATE process from the PTY below. The terminal app
    // runs the command independently, so its state may diverge from xterm.js.
    // See the createPeekabooBackend JSDoc for the full explanation.
    if (visual && !appHandle) {
      appHandle = await launchTerminalApp(app, command, spawnOpts)
    }

    // Spawn a SECOND process via PTY that feeds data to the xterm.js backend.
    // This is independent from the terminal app process above.
    const pty = spawnPty({
      command,
      env: spawnOpts?.env,
      cwd: spawnOpts?.cwd,
      cols: currentCols,
      rows: currentRows,
      onData: (data) => {
        xterm.feed(data)
      },
    })

    return pty
  }

  // ── Peekaboo: Screenshot ──

  async function takeScreenshot(): Promise<Buffer> {
    if (!visual) {
      throw new Error("Visual mode is not enabled — create backend with { visual: true }")
    }
    if (!appHandle) {
      throw new Error("No terminal app launched — call spawnCommand() first")
    }
    return captureAppWindow(app)
  }

  // ── Capabilities ──

  const capabilities: TerminalCapabilities = {
    name: "peekaboo",
    version: "0.1.0",
    // Data capabilities match xterm.js since we delegate to it
    truecolor: true,
    kittyKeyboard: false,
    kittyGraphics: false,
    sixel: false,
    osc8Hyperlinks: true,
    semanticPrompts: false,
    unicode: "15.1",
    reflow: true,
    extensions: new Set(["screenshot"]),
  }

  return {
    name: "peekaboo",

    // TerminalBackend: Lifecycle
    init,
    destroy,

    // TerminalBackend: Data flow
    feed,
    resize,
    reset,

    // TerminalBackend: Read operations
    getText,
    getTextRange,
    getCell,
    getLine,
    getLines,
    getCursor,
    getMode,
    getTitle,
    getScrollback,
    scrollViewport,
    encodeKey,

    // TerminalBackend: Capabilities
    capabilities,

    // Peekaboo extensions
    takeScreenshot,
    spawnCommand,

    get terminalApp(): TerminalApp | null {
      return visual ? app : null
    },

    get visualActive(): boolean {
      return visual && appHandle !== null
    },

    get appPid(): number | null {
      return appHandle?.pid ?? null
    },
  }
}
