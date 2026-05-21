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

import { spawnSync } from "node:child_process"
import { createXtermBackend } from "../../xtermjs/src/backend.ts"
import { spawnPty, type PtyHandle } from "../../../src/terminal/pty.ts"
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
} from "../../../src/terminal/types.ts"

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

// ─────────────────────────────────────────────────────────
// Process-wide window tracking
// ─────────────────────────────────────────────────────────
//
// Every window peekaboo opens is registered here. A single process-exit
// handler closes all tracked windows on SIGINT/SIGTERM/normal exit so
// terminal windows can't leak if a script forgets to call destroy() or
// crashes mid-run.
//
// "close front window" was the original cleanup path; that's racy — if the
// user activates another window before destroy fires, the wrong window
// closes. We now capture an AppleScript window id where we can (iTerm2,
// Terminal.app) and target by id; for apps that don't expose ids we fall
// back to a pid-targeted kill of the launcher process AND a window-name
// close as a belt-and-suspenders pass.
//
// Tracked windows are removed from the registry when their owning backend
// calls destroy() cleanly. The exit handler only sees windows that leaked.

type TrackedWindow = {
  app: TerminalApp
  /** AppleScript window id (iTerm2, Terminal.app) — preferred close path. */
  windowId?: string
  /** Launcher process pid — used for diagnostics + fallback signal. */
  pid: number
  /** ms epoch when launched — diagnostic. */
  launchedAt: number
}

const TRACKED_WINDOWS = new Set<TrackedWindow>()
let exitHandlerInstalled = false

function installExitHandler(): void {
  if (exitHandlerInstalled) return
  exitHandlerInstalled = true

  const flush = (): void => {
    // Synchronous close — exit handlers can't await. Use osascript's
    // standalone close command per window. iTerm2/Terminal use the id;
    // others get a best-effort "close front window" since by exit time
    // there's usually only one window left.
    for (const w of TRACKED_WINDOWS) {
      try {
        const bundle = APP_BUNDLE_NAMES[w.app]
        const script = w.windowId
          ? `tell application "${bundle}" to close (every window whose id is ${w.windowId})`
          : `tell application "${bundle}" to close front window`
        // Sync osascript on exit — best effort.
        spawnSync("osascript", ["-e", script], {
          stdio: "ignore",
          timeout: 2000,
        })
      } catch {
        // Best-effort — process is exiting anyway.
      }
    }
    TRACKED_WINDOWS.clear()
  }

  process.on("exit", flush)
  process.on("SIGINT", () => {
    flush()
    process.exit(130)
  })
  process.on("SIGTERM", () => {
    flush()
    process.exit(143)
  })
  process.on("SIGHUP", () => {
    flush()
    process.exit(129)
  })
}

/**
 * Snapshot the AppleScript ids of every open Ghostty window. Used to diff
 * pre/post-launch and identify which window we just spawned, so we can
 * target it precisely for cleanup (vs the racy "close front window").
 *
 * Returns an empty list if Ghostty isn't running yet — `open -a` will start
 * it, and the polling loop in the launcher catches the new window.
 */
async function listGhosttyWindowIds(): Promise<string[]> {
  try {
    const r = await exec(
      [
        "osascript",
        "-e",
        `if application "Ghostty" is running then
           tell application "Ghostty" to return id of every window as text
         else
           return ""
         end if`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    )
    if (r.exitCode !== 0) return []
    const out = r.stdout.trim()
    if (!out) return []
    return out
      .split(", ")
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

/** Launch a terminal app with a command. Returns the app process. */
/**
 * Synchronously close a tracked terminal window via osascript. Used by
 * destroy() — the calling code's interface is sync, and async close()
 * was racing with process exit, leaking windows.
 */
function closeAppWindowSync(app: TerminalApp, windowId?: string): void {
  const bundleName = APP_BUNDLE_NAMES[app]
  const script = windowId
    ? `tell application "${bundleName}" to close (every window whose id is ${windowId})`
    : `tell application "${bundleName}" to close front window`
  spawnSync("osascript", ["-e", script], { stdio: "ignore", timeout: 2000 })
}

async function launchTerminalApp(
  app: TerminalApp,
  command: string[],
  opts?: { env?: Record<string, string>; cwd?: string },
): Promise<{ pid: number; close: () => Promise<void>; tracked?: TrackedWindow }> {
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
  let windowId: string | undefined

  switch (app) {
    case "ghostty": {
      // Ghostty supports --command flag. Snapshot existing window ids before
      // launch, spawn, then diff to find the newly-created window. Ghostty
      // exposes AppleScript `id of front window` so we can target the new
      // window for close later — preferred over "close front window" which
      // races on user focus changes.
      const beforeIds = await listGhosttyWindowIds()
      handle = execDetached(["open", "-a", "Ghostty", "--args", "-e", fullCmd])
      // Poll for a new window — typical launch is sub-second on warm app.
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 100))
        const nowIds = await listGhosttyWindowIds()
        const fresh = nowIds.find((id) => !beforeIds.includes(id))
        if (fresh) {
          windowId = fresh
          break
        }
      }
      break
    }
    case "iterm2": {
      // Tell iTerm2 to create a window with the command, returning the new
      // window's AppleScript id. We capture this synchronously via exec
      // (not execDetached) because the script returns the id on stdout.
      const script = `
        tell application "iTerm2"
          set newWindow to (create window with default profile command "${fullCmd.replace(/"/g, '\\"')}")
          return id of newWindow as text
        end tell
      `
      const r = await exec(["osascript", "-e", script], { stdout: "pipe", stderr: "pipe" })
      if (r.exitCode === 0) windowId = r.stdout.trim() || undefined
      // We don't get a useful pid here (osascript exits), so use the
      // osascript invocation's pid as a placeholder for diagnostics.
      handle = { pid: -1, exited: Promise.resolve(r.exitCode) }
      break
    }
    case "terminal": {
      // Terminal.app — `do script` returns a tab whose containing window
      // gets a unique id. Capture it synchronously.
      const script = `
        tell application "Terminal"
          set newTab to do script "${fullCmd.replace(/"/g, '\\"')}"
          activate
          return id of (window 1 whose tabs contains newTab) as text
        end tell
      `
      const r = await exec(["osascript", "-e", script], { stdout: "pipe", stderr: "pipe" })
      if (r.exitCode === 0) windowId = r.stdout.trim() || undefined
      handle = { pid: -1, exited: Promise.resolve(r.exitCode) }
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

  // Register with the process-wide tracker so the exit handler closes the
  // window even if destroy() never runs (Ctrl-C, crash, forgotten close).
  installExitHandler()
  const tracked: TrackedWindow = {
    app,
    windowId,
    pid: handle.pid,
    launchedAt: Date.now(),
  }
  TRACKED_WINDOWS.add(tracked)

  return {
    pid: handle.pid,
    tracked,
    async close() {
      // Window-id targeted close beats "close front window" — survives
      // the user activating another window between launch and close.
      try {
        const bundleName = APP_BUNDLE_NAMES[app]
        const closeScript = tracked.windowId
          ? `tell application "${bundleName}" to close (every window whose id is ${tracked.windowId})`
          : `tell application "${bundleName}" to close front window`
        await exec(["osascript", "-e", closeScript])
      } catch {
        // Ignore close errors — process-exit handler will retry.
      } finally {
        TRACKED_WINDOWS.delete(tracked)
      }
    },
  }
}

/** Capture a screenshot of a specific application window using screencapture (macOS). */
async function captureAppWindow(app: TerminalApp): Promise<Buffer> {
  const tmpPath = `/tmp/peekaboo-screenshot-${crypto.randomUUID()}.png`
  const bundleName = APP_BUNDLE_NAMES[app]

  // Preferred: query the window's position + size via System Events, then
  // capture the corresponding screen region. Avoids both interactive
  // (`screencapture -w`) and the CGWindowID-vs-AppleScript-id mismatch
  // (`-l <id>` expects a CGWindowID; Ghostty's AppleScript `id` returns a
  // different identifier). Activates the app first so the window is
  // frontmost — this skirts the screencapture-blocks-occluded-windows
  // limitation.
  await exec(["osascript", "-e", `tell application "${bundleName}" to activate`])
  await new Promise((resolve) => setTimeout(resolve, 300))

  const boundsResult = await exec(
    [
      "osascript",
      "-e",
      `tell application "System Events" to tell process "${bundleName}"
         set p to position of front window
         set s to size of front window
         return (item 1 of p as text) & "," & (item 2 of p as text) & "," & (item 1 of s as text) & "," & (item 2 of s as text)
       end tell`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  )

  if (boundsResult.exitCode === 0 && boundsResult.stdout.trim()) {
    // bounds = "x,y,w,h" in screen points
    const captureResult = await exec(["screencapture", "-R", boundsResult.stdout.trim(), "-o", "-x", tmpPath], {
      stderr: "pipe",
    })
    if (captureResult.exitCode !== 0) {
      throw new Error(`screencapture failed with exit code ${captureResult.exitCode}: ${captureResult.stderr.trim()}`)
    }
  } else {
    // Fallback: try CGWindowID via System Events `id`. Some apps expose it;
    // when they don't, fall through to interactive `-w` which prompts the
    // user to click a window — last resort.
    const idResult = await exec(
      [
        "osascript",
        "-e",
        `tell application "System Events" to tell process "${bundleName}" to return id of front window`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    )
    const windowId = idResult.stdout.trim()
    if (idResult.exitCode === 0 && windowId && windowId !== "missing value") {
      const captureResult = await exec(["screencapture", "-l", windowId, "-o", "-x", tmpPath], { stderr: "pipe" })
      if (captureResult.exitCode !== 0) {
        throw new Error(`screencapture -l failed: ${captureResult.stderr.trim()}`)
      }
    } else {
      // Last resort — interactive. Prompts the user to click a window.
      // Avoid this in automated runs; it surfaces a screencapture cursor.
      const captureResult = await exec(["screencapture", "-w", "-o", "-x", tmpPath], { stderr: "pipe" })
      if (captureResult.exitCode !== 0) {
        throw new Error(`screencapture -w failed: ${captureResult.stderr.trim()}`)
      }
    }
  }

  const buffer = await readFileAsBuffer(tmpPath)
  try {
    const { unlink } = await import("node:fs/promises")
    await unlink(tmpPath)
  } catch {
    // Best-effort cleanup
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
  let appHandle: { pid: number; close: () => Promise<void>; tracked?: TrackedWindow } | null = null

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
      // TerminalBackend.destroy is sync but we MUST close the window
      // synchronously here — async close() is fire-and-forget and the
      // calling process often exits before the osascript completes,
      // leaking the window. Use sync osascript via spawnSync.
      const h = appHandle
      appHandle = null
      try {
        closeAppWindowSync(app, h.tracked?.windowId)
      } catch {
        // Best-effort — process-exit handler is the safety net.
      } finally {
        if (h.tracked) TRACKED_WINDOWS.delete(h.tracked)
      }
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
