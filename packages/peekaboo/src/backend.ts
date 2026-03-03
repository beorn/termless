/**
 * Peekaboo backend for termless.
 *
 * Combines a headless xterm.js backend (for data) with a real terminal app
 * (for visual verification). Data methods delegate to the xterm backend.
 * Visual methods launch a terminal app and take screenshots via screencapture.
 *
 * Architecture:
 * 1. PTY spawns a process, piping output to the xterm.js backend for cell data
 * 2. The same PTY output is rendered in a real terminal app window
 * 3. takeScreenshot() captures the real terminal app for visual comparison
 *
 * The "data path" (getText, getCell, etc.) uses xterm.js for speed/accuracy.
 * The "visual path" (takeScreenshot) uses the real terminal for fidelity.
 */

import { createXtermBackend } from "../../xtermjs/src/backend.ts"
import { spawnPty, type PtyHandle } from "../../../src/pty.ts"
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

  let proc: ReturnType<typeof Bun.spawn>

  switch (app) {
    case "ghostty": {
      // Ghostty supports --command flag
      proc = Bun.spawn(["open", "-a", "Ghostty", "--args", "-e", fullCmd], {
        stdout: "ignore",
        stderr: "ignore",
      })
      break
    }
    case "iterm2": {
      // Use osascript to tell iTerm2 to create a new window with the command
      const script = `
        tell application "iTerm2"
          create window with default profile command "${fullCmd.replace(/"/g, '\\"')}"
        end tell
      `
      proc = Bun.spawn(["osascript", "-e", script], {
        stdout: "ignore",
        stderr: "ignore",
      })
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
      proc = Bun.spawn(["osascript", "-e", script], {
        stdout: "ignore",
        stderr: "ignore",
      })
      break
    }
    case "wezterm": {
      proc = Bun.spawn(["open", "-a", "WezTerm", "--args", "start", "--", "bash", "-c", fullCmd], {
        stdout: "ignore",
        stderr: "ignore",
      })
      break
    }
    case "kitty": {
      proc = Bun.spawn(["open", "-a", "kitty", "--args", "bash", "-c", fullCmd], {
        stdout: "ignore",
        stderr: "ignore",
      })
      break
    }
  }

  // Wait briefly for the app to launch
  await new Promise((resolve) => setTimeout(resolve, 1000))

  return {
    pid: proc.pid,
    async close() {
      // Try graceful close via osascript
      try {
        const bundleName = APP_BUNDLE_NAMES[app]
        const closeScript = `tell application "${bundleName}" to close front window`
        const closer = Bun.spawn(["osascript", "-e", closeScript], {
          stdout: "ignore",
          stderr: "ignore",
        })
        await closer.exited
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

  const windowIdProc = Bun.spawn(["osascript", "-e", getWindowIdScript], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const windowIdText = await new Response(windowIdProc.stdout).text()
  const windowIdExit = await windowIdProc.exited

  const windowId = windowIdText.trim()

  if (windowId && windowIdExit === 0) {
    // Capture specific window by ID
    const captureProc = Bun.spawn(["screencapture", "-l", windowId, "-o", "-x", tmpPath], {
      stdout: "ignore",
      stderr: "pipe",
    })
    const captureExit = await captureProc.exited
    if (captureExit !== 0) {
      const stderr = await new Response(captureProc.stderr).text()
      throw new Error(`screencapture failed with exit code ${captureExit}: ${stderr.trim()}`)
    }
  } else {
    // Fallback: capture the frontmost window
    // Bring the app to front first
    const activateScript = `tell application "${bundleName}" to activate`
    const activateProc = Bun.spawn(["osascript", "-e", activateScript], {
      stdout: "ignore",
      stderr: "ignore",
    })
    await activateProc.exited
    await new Promise((resolve) => setTimeout(resolve, 300))

    const captureProc = Bun.spawn(["screencapture", "-w", "-o", "-x", tmpPath], {
      stdout: "ignore",
      stderr: "pipe",
    })
    const captureExit = await captureProc.exited
    if (captureExit !== 0) {
      const stderr = await new Response(captureProc.stderr).text()
      throw new Error(`screencapture failed with exit code ${captureExit}: ${stderr.trim()}`)
    }
  }

  // Read the screenshot file
  const file = Bun.file(tmpPath)
  const buffer = Buffer.from(await file.arrayBuffer())

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
 * Usage:
 *   const backend = createPeekabooBackend({ visual: true, app: "ghostty" })
 *   backend.init({ cols: 80, rows: 24 })
 *   const pty = await backend.spawnCommand(["bun", "km"])
 *   await new Promise(r => setTimeout(r, 2000))
 *   const text = backend.getText()        // from xterm.js
 *   const png = await backend.takeScreenshot()  // from real terminal
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

    // Launch real terminal app if visual mode is enabled
    if (visual && !appHandle) {
      appHandle = await launchTerminalApp(app, command, spawnOpts)
    }

    // Spawn PTY that feeds data to the xterm.js backend
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
