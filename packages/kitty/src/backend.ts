/**
 * Kitty backend for termless.
 *
 * Uses kitty's actual VT parser via a Python subprocess bridge. Kitty's
 * terminal emulation code is tightly coupled to CPython, so we run it inside
 * kitty's bundled Python environment (`kitty +runpy`) and communicate via
 * batch replay: mutations accumulate in an in-memory command log, and when
 * a query is needed, ALL commands are replayed in a single `execFileSync`
 * call. The snapshot is cached until the next mutation.
 *
 * This avoids the persistent subprocess approach (spawn + readSync/writeSync)
 * which fails in Bun because `child.stdout.fd` is undefined.
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
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname } from "node:path"
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
// Bridge path
// ===============================================================

// Use import.meta.url (standard) instead of import.meta.dir (Bun-only)
const __kittyDir = dirname(dirname(fileURLToPath(import.meta.url)))
const BRIDGE_SCRIPT = `${__kittyDir}/build/bridge.py`

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
 * Uses kitty's VT parser via batch replay: mutations (feed, resize, reset)
 * accumulate in an in-memory command log. When a query is needed (getCell,
 * getText, getCursor, etc.), ALL commands are replayed in a single
 * `execFileSync` call, producing a snapshot that is cached until the next
 * mutation.
 *
 * This ensures exact kitty behavior without requiring native module compilation
 * or persistent subprocess IPC (which fails in Bun due to missing fd support).
 *
 * @param opts - Optional terminal dimensions for eager initialization
 */
export function createKittyBackend(opts?: Partial<TerminalOptions>): TerminalBackend {
  let cols = DEFAULT_COLS
  let rows = DEFAULT_ROWS
  let scrollbackLimit = 1000
  let initialized = false

  // Command log — accumulated mutations replayed on query
  let commandLog: BridgeCommand[] = []

  // Cached snapshot from last query
  let snapshot: BridgeSnapshot | null = null

  function ensureInit(): void {
    if (!initialized) throw new Error("kitty backend not initialized -- call init() first")
  }

  function invalidateSnapshot(): void {
    snapshot = null
  }

  /**
   * Replay all accumulated commands in a single execFileSync call.
   * Returns the snapshot of terminal state after all commands are applied.
   */
  function replayAndSnapshot(): BridgeSnapshot {
    const kitty = findKitty()
    const bridgeDir = dirname(BRIDGE_SCRIPT)
    const input = JSON.stringify({ commands: commandLog })

    const result = execFileSync(
      kitty,
      ["+runpy", `import sys; sys.path.insert(0, ${JSON.stringify(bridgeDir)}); import bridge; bridge.batch_main()`],
      {
        input,
        timeout: 30000,
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024, // 50MB — large terminal snapshots
      },
    )

    const trimmed = result.trim()
    if (!trimmed) {
      throw new Error("Kitty bridge returned empty response")
    }

    let parsed: BridgeSnapshot & { error?: string; traceback?: string }
    try {
      parsed = JSON.parse(trimmed) as BridgeSnapshot & { error?: string; traceback?: string }
    } catch {
      throw new Error(`Kitty bridge returned unparseable response: ${trimmed.slice(0, 200)}`)
    }

    if (parsed.error) {
      throw new Error(`Kitty bridge error: ${parsed.error}\n${parsed.traceback ?? ""}`)
    }

    if (!("cells" in parsed)) {
      throw new Error("Kitty bridge returned no snapshot")
    }

    return parsed
  }

  function ensureSnapshot(): BridgeSnapshot {
    ensureInit()
    if (snapshot) return snapshot
    snapshot = replayAndSnapshot()
    return snapshot
  }

  function init(options: TerminalOptions): void {
    cols = options.cols
    rows = options.rows
    scrollbackLimit = options.scrollbackLimit ?? 1000

    // Reset command log with init as the first command
    commandLog = [{ op: "init", cols, rows, scrollbackLimit }]
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
    commandLog = []
    initialized = false
    snapshot = null
  }

  function feed(data: Uint8Array): void {
    ensureInit()
    commandLog.push({ op: "feed", data: Buffer.from(data).toString("base64") })
    invalidateSnapshot()
  }

  function resize(newCols: number, newRows: number): void {
    ensureInit()
    cols = newCols
    rows = newRows
    commandLog.push({ op: "resize", cols: newCols, rows: newRows })
    invalidateSnapshot()
  }

  function reset(): void {
    ensureInit()
    commandLog.push({ op: "reset" })
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
      for (let col = colStart; col < colEnd && col < cellRow!.length; col++) {
        const text = cellRow![col]!.text
        line += text || " "
      }
      lines.push(line.trimEnd())
    }
    return lines.join("\n")
  }

  function getCell(row: number, col: number): Cell {
    const s = ensureSnapshot()
    if (row >= s.cells.length || col >= s.cells[row]!.length) {
      return EMPTY_CELL
    }
    return convertBridgeCell(s.cells[row]![col]!)
  }

  function getLine(row: number): Cell[] {
    const s = ensureSnapshot()
    if (row >= s.cells.length) {
      return Array.from({ length: cols }, () => EMPTY_CELL)
    }
    return s.cells[row]!.map(convertBridgeCell)
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
    commandLog.push({ op: "scroll", delta })
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

  // TODO: Python bridge doesn't capture DA1/DA2/DSR responses yet.
  // Requires extending bridge.py to capture responses from kitty's VT parser
  // and include them in the snapshot JSON. The response data would need to be
  // read after each feed command and forwarded here.

  const backend: TerminalBackend = {
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

  return backend
}
