/**
 * Kitty backend for termless.
 *
 * Uses kitty's actual VT parser via a Python subprocess bridge. Kitty's
 * terminal emulation code is tightly coupled to CPython, so we run it inside
 * kitty's bundled Python environment (`kitty +runpy`) and communicate via
 * stdin/stdout JSON-RPC.
 *
 * Kitty is licensed under GPL-3.0 — the subprocess uses kitty's own binary
 * (installed separately) and does NOT produce distributable artifacts.
 *
 * Requires kitty to be installed:
 *   brew install --cask kitty   # macOS
 *   # or install from https://sw.kovidgoyal.net/kitty
 */

import type {
  TerminalBackend,
  TerminalOptions,
  Cell,
  CursorState,
  TerminalMode,
  ScrollbackState,
  TerminalCapabilities,
  RGB,
} from "../../../src/types.ts"
import { encodeKeyToAnsi } from "../../../src/key-encoding.ts"
import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { existsSync, readSync, writeSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

// ===============================================================
// Kitty binary discovery
// ===============================================================

const KITTY_PATHS = [
  "/Applications/kitty.app/Contents/MacOS/kitty",
  "/usr/local/bin/kitty",
  "/usr/bin/kitty",
  "/opt/homebrew/bin/kitty",
]

let kittyPath: string | null = null

function findKitty(): string {
  if (kittyPath) return kittyPath

  for (const p of KITTY_PATHS) {
    if (existsSync(p)) {
      kittyPath = p
      return p
    }
  }

  // Try PATH
  try {
    const result = execFileSync("which", ["kitty"], { encoding: "utf-8" }).trim()
    if (result && existsSync(result)) {
      kittyPath = result
      return result
    }
  } catch {
    // not in PATH
  }

  throw new Error(
    "Kitty terminal not found. Install it:\n" +
      "  brew install --cask kitty   # macOS\n" +
      "  # or visit https://sw.kovidgoyal.net/kitty\n",
  )
}

// ===============================================================
// Bridge protocol types
// ===============================================================

interface BridgeCommand {
  op: "init" | "feed" | "resize" | "reset" | "scroll" | "snapshot" | "quit"
  [key: string]: unknown
}

interface BridgeCell {
  text: string
  fg: [number, number, number] | null
  bg: [number, number, number] | null
  bold: boolean
  dim: boolean
  italic: boolean
  underline: string
  strikethrough: boolean
  inverse: boolean
  blink: boolean
  wide: boolean
}

interface BridgeCursor {
  x: number
  y: number
  visible: boolean
  style: string
}

interface BridgeSnapshot {
  cells: BridgeCell[][]
  cursor: BridgeCursor
  title: string
  modes: Record<string, boolean>
  scrollback: { viewportOffset: number; totalLines: number; screenLines: number }
  text: string
  error?: string
}

// ===============================================================
// Bridge communication
// ===============================================================

// Use import.meta.url (standard) instead of import.meta.dir (Bun-only)
const __kittyDir = dirname(dirname(fileURLToPath(import.meta.url)))
const BRIDGE_SCRIPT = join(__kittyDir, "build", "bridge.py")

/**
 * Persistent kitty bridge process. Spawned once, kept alive across queries.
 * Commands are sent via stdin; responses read synchronously from stdout fd.
 */
interface BridgeProcess {
  child: ChildProcess
  /** File descriptor for reading stdout synchronously */
  stdoutFd: number
  /** Leftover bytes from previous reads (partial line buffering) */
  readBuffer: string
}

function spawnBridge(): BridgeProcess {
  const kitty = findKitty()
  const child = spawn(
    kitty,
    [
      "+runpy",
      `import sys; sys.path.insert(0, ${JSON.stringify(dirname(BRIDGE_SCRIPT))}); import bridge; bridge.main()`,
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
    },
  )

  // Get the raw fd for synchronous reads.
  // child.stdout is a Readable stream wrapping an fd — we need the raw fd.
  const stdoutFd = (child.stdout as unknown as { fd: number }).fd

  // Pause the stream so Node.js doesn't consume data via the event loop
  child.stdout!.pause()

  return { child, stdoutFd, readBuffer: "" }
}

/**
 * Read a complete line (newline-terminated) from the bridge's stdout fd.
 * Blocks synchronously until a full line is available.
 */
function readLine(bridge: BridgeProcess): string {
  const buf = Buffer.alloc(65536)

  while (true) {
    // Check if we already have a complete line in the buffer
    const nlIndex = bridge.readBuffer.indexOf("\n")
    if (nlIndex !== -1) {
      const line = bridge.readBuffer.slice(0, nlIndex)
      bridge.readBuffer = bridge.readBuffer.slice(nlIndex + 1)
      return line
    }

    // Read more data from the fd (blocks until data available)
    const bytesRead = readSync(bridge.stdoutFd, buf)
    if (bytesRead === 0) {
      throw new Error("Kitty bridge process closed stdout unexpectedly")
    }
    bridge.readBuffer += buf.toString("utf-8", 0, bytesRead)
  }
}

/**
 * Send a single command to the bridge and wait for its response.
 */
function sendCommand(bridge: BridgeProcess, cmd: BridgeCommand, _timeoutMs = 30000): unknown {
  const data = JSON.stringify(cmd) + "\n"
  const stdinFd = (bridge.child.stdin as unknown as { fd: number }).fd
  writeSync(stdinFd, data)
  const line = readLine(bridge)
  try {
    return JSON.parse(line)
  } catch {
    throw new Error(`Kitty bridge returned unparseable response: ${line}`)
  }
}

/**
 * Wait for the bridge's ready signal.
 */
function waitForReady(bridge: BridgeProcess): void {
  const line = readLine(bridge)
  try {
    const parsed = JSON.parse(line)
    if (!parsed.ready) {
      throw new Error(`Expected ready signal, got: ${line}`)
    }
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error(`Kitty bridge ready signal unparseable: ${line}`)
    }
    throw e
  }
}

function killBridge(bridge: BridgeProcess | null): void {
  if (!bridge) return
  try {
    bridge.child.stdin?.end()
    bridge.child.kill()
  } catch {
    // already dead
  }
}

// ===============================================================
// Cell conversion
// ===============================================================

function convertBridgeCell(cell: BridgeCell): Cell {
  const fg: RGB | null = cell.fg ? { r: cell.fg[0], g: cell.fg[1], b: cell.fg[2] } : null
  const bg: RGB | null = cell.bg ? { r: cell.bg[0], g: cell.bg[1], b: cell.bg[2] } : null

  return {
    char: cell.text,
    fg,
    bg,
    bold: cell.bold,
    dim: cell.dim,
    italic: cell.italic,
    underline: cell.underline === "none" ? false : (cell.underline as Cell["underline"]),
    underlineColor: null,
    strikethrough: cell.strikethrough,
    inverse: cell.inverse,
    blink: cell.blink ?? false,
    hidden: false,
    wide: cell.wide,
    continuation: false,
    hyperlink: null,
  }
}

const EMPTY_CELL: Cell = {
  char: "",
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  underlineColor: null,
  strikethrough: false,
  inverse: false,
  blink: false,
  hidden: false,
  wide: false,
  continuation: false,
  hyperlink: null,
}

// ===============================================================
// Backend factory
// ===============================================================

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

/**
 * Check if kitty is installed and available.
 */
export function isKittyAvailable(): boolean {
  try {
    findKitty()
    return true
  } catch {
    return false
  }
}

/**
 * Create a kitty backend for termless.
 *
 * Uses kitty's VT parser via a persistent Python subprocess bridge. The bridge
 * process is spawned once in init() and kept alive across all mutations and
 * queries, communicating via stdin/stdout JSON-RPC. This avoids replaying the
 * full command history in a fresh subprocess on every query.
 *
 * This ensures exact kitty behavior without requiring native module compilation.
 *
 * @param opts - Optional terminal dimensions for eager initialization
 */
export function createKittyBackend(opts?: Partial<TerminalOptions>): TerminalBackend {
  let cols = DEFAULT_COLS
  let rows = DEFAULT_ROWS
  let scrollbackLimit = 1000
  let initialized = false

  // Persistent bridge process — spawned once, kept alive across queries
  let bridge: BridgeProcess | null = null

  // Cached snapshot from last query
  let snapshot: BridgeSnapshot | null = null

  function ensureInit(): void {
    if (!initialized) throw new Error("kitty backend not initialized -- call init() first")
  }

  function invalidateSnapshot(): void {
    snapshot = null
  }

  /**
   * Send a mutation command to the persistent bridge process.
   * The command is applied immediately — no replay needed.
   */
  function sendMutation(cmd: BridgeCommand): void {
    if (!bridge) throw new Error("kitty bridge process not running")
    const response = sendCommand(bridge, cmd) as { ok?: boolean; error?: string; traceback?: string }
    if (response.error) {
      throw new Error(`Kitty bridge error: ${response.error}\n${response.traceback ?? ""}`)
    }
  }

  function ensureSnapshot(): BridgeSnapshot {
    ensureInit()
    if (snapshot) return snapshot

    if (!bridge) throw new Error("kitty bridge process not running")

    const response = sendCommand(bridge, { op: "snapshot" }) as BridgeSnapshot & {
      error?: string
      traceback?: string
    }
    if (response.error) {
      throw new Error(`Kitty bridge error: ${response.error}\n${response.traceback ?? ""}`)
    }
    if (!("cells" in response)) {
      throw new Error("Kitty bridge returned no snapshot")
    }

    snapshot = response
    return snapshot
  }

  function init(options: TerminalOptions): void {
    // Kill any existing bridge process
    killBridge(bridge)
    bridge = null

    cols = options.cols
    rows = options.rows
    scrollbackLimit = options.scrollbackLimit ?? 1000

    // Spawn persistent bridge process
    bridge = spawnBridge()
    waitForReady(bridge)

    // Initialize the terminal in the bridge
    sendMutation({ op: "init", cols, rows, scrollbackLimit })
    initialized = true
    snapshot = null
  }

  // Eagerly init if opts provided
  if (opts) {
    init({
      cols: opts.cols ?? DEFAULT_COLS,
      rows: opts.rows ?? DEFAULT_ROWS,
      scrollbackLimit: opts.scrollbackLimit,
    })
  }

  function destroy(): void {
    if (bridge) {
      try {
        sendCommand(bridge, { op: "quit" }, 5000)
      } catch {
        // process may already be dead
      }
      killBridge(bridge)
      bridge = null
    }
    initialized = false
    snapshot = null
  }

  function feed(data: Uint8Array): void {
    ensureInit()
    sendMutation({ op: "feed", data: Buffer.from(data).toString("base64") })
    invalidateSnapshot()
  }

  function resize(newCols: number, newRows: number): void {
    ensureInit()
    cols = newCols
    rows = newRows
    sendMutation({ op: "resize", cols: newCols, rows: newRows })
    invalidateSnapshot()
  }

  function reset(): void {
    ensureInit()
    sendMutation({ op: "reset" })
    invalidateSnapshot()
  }

  function getText(): string {
    const s = ensureSnapshot()
    return s.text
  }

  function getTextRange(startRow: number, startCol: number, endRow: number, endCol: number): string {
    const s = ensureSnapshot()
    const lines: string[] = []
    for (let row = startRow; row <= endRow; row++) {
      if (row >= s.cells.length) break
      const cellRow = s.cells[row]
      const colStart = row === startRow ? startCol : 0
      const colEnd = row === endRow ? endCol : cols
      let line = ""
      for (let col = colStart; col < colEnd && col < cellRow.length; col++) {
        const text = cellRow[col].text
        line += text || " "
      }
      lines.push(line.trimEnd())
    }
    return lines.join("\n")
  }

  function getCell(row: number, col: number): Cell {
    const s = ensureSnapshot()
    if (row >= s.cells.length || col >= s.cells[row].length) {
      return EMPTY_CELL
    }
    return convertBridgeCell(s.cells[row][col])
  }

  function getLine(row: number): Cell[] {
    const s = ensureSnapshot()
    if (row >= s.cells.length) {
      return Array.from({ length: cols }, () => EMPTY_CELL)
    }
    return s.cells[row].map(convertBridgeCell)
  }

  function getLines(): Cell[][] {
    const s = ensureSnapshot()
    return s.cells.map((row) => row.map(convertBridgeCell))
  }

  function getCursor(): CursorState {
    const s = ensureSnapshot()
    return {
      x: s.cursor.x,
      y: s.cursor.y,
      visible: s.cursor.visible,
      style: (s.cursor.style as CursorState["style"]) ?? "block",
    }
  }

  function getMode(mode: TerminalMode): boolean {
    const s = ensureSnapshot()
    return s.modes[mode] ?? false
  }

  function getTitle(): string {
    const s = ensureSnapshot()
    return s.title
  }

  function getScrollback(): ScrollbackState {
    const s = ensureSnapshot()
    return {
      viewportOffset: s.scrollback.viewportOffset,
      totalLines: s.scrollback.totalLines,
      screenLines: s.scrollback.screenLines,
    }
  }

  function scrollViewport(delta: number): void {
    ensureInit()
    sendMutation({ op: "scroll", delta })
    invalidateSnapshot()
  }

  const capabilities: TerminalCapabilities = {
    name: "kitty",
    version: "0.1.0",
    truecolor: true,
    kittyKeyboard: true,
    kittyGraphics: true,
    sixel: false,
    osc8Hyperlinks: true,
    semanticPrompts: false,
    unicode: "15.1",
    reflow: true,
    extensions: new Set(),
  }

  return {
    name: "kitty",
    init,
    destroy,
    feed,
    resize,
    reset,
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
    encodeKey: encodeKeyToAnsi,
    capabilities,
  }
}
