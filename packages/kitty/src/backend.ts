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
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
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
 * Execute a batch of commands against the kitty bridge in a single
 * subprocess invocation. Returns the array of responses (one per command).
 */
function executeBatch(commands: BridgeCommand[]): unknown[] {
  const kitty = findKitty()
  const input = commands.map((c) => JSON.stringify(c)).join("\n") + "\n"

  const result = execFileSync(
    kitty,
    [
      "+runpy",
      `import sys; sys.path.insert(0, ${JSON.stringify(dirname(BRIDGE_SCRIPT))}); import bridge; bridge.main()`,
    ],
    {
      input,
      encoding: "utf-8",
      timeout: 30000,
      maxBuffer: 64 * 1024 * 1024, // 64MB
    },
  )

  // Parse responses (first line is {ready:true}, then one per command)
  const lines = result.trim().split("\n")
  const responses: unknown[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line)
      if (parsed.ready) continue // skip ready signal
      responses.push(parsed)
    } catch {
      // skip unparseable lines
    }
  }

  return responses
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
 * Uses kitty's VT parser via a Python subprocess bridge. Each mutation
 * (feed, resize, reset) replays the full command history in a fresh kitty
 * subprocess and caches the resulting terminal snapshot. Queries (getCell,
 * getCursor, etc.) are served from the cached snapshot.
 *
 * This ensures exact kitty behavior without requiring native module compilation.
 * The tradeoff is ~15ms per mutation call (subprocess overhead).
 *
 * @param opts - Optional terminal dimensions for eager initialization
 */
export function createKittyBackend(opts?: Partial<TerminalOptions>): TerminalBackend {
  let cols = DEFAULT_COLS
  let rows = DEFAULT_ROWS
  let scrollbackLimit = 1000
  let initialized = false

  // Command log — replayed in each subprocess invocation
  const commandLog: BridgeCommand[] = []

  // Cached snapshot from last replay
  let snapshot: BridgeSnapshot | null = null

  function ensureInit(): void {
    if (!initialized) throw new Error("kitty backend not initialized -- call init() first")
  }

  function invalidateSnapshot(): void {
    snapshot = null
  }

  function ensureSnapshot(): BridgeSnapshot {
    ensureInit()
    if (snapshot) return snapshot

    // Replay entire command history
    const commands: BridgeCommand[] = [
      { op: "init", cols, rows, scrollbackLimit },
      ...commandLog,
      { op: "snapshot" },
      { op: "quit" },
    ]

    const responses = executeBatch(commands)

    // Find the snapshot response (has cells array)
    const snapshotResponse = responses.find(
      (r): r is BridgeSnapshot => r != null && typeof r === "object" && "cells" in (r as object),
    )
    if (!snapshotResponse) {
      // Check for errors in any response
      const errorResponse = responses.find((r) => r != null && typeof r === "object" && "error" in (r as object)) as
        | { error: string; traceback?: string }
        | undefined
      if (errorResponse) {
        throw new Error(`Kitty bridge error: ${errorResponse.error}\n${errorResponse.traceback ?? ""}`)
      }
      throw new Error("Kitty bridge returned no snapshot")
    }

    snapshot = snapshotResponse
    return snapshot
  }

  function init(options: TerminalOptions): void {
    cols = options.cols
    rows = options.rows
    scrollbackLimit = options.scrollbackLimit ?? 1000
    initialized = true
    commandLog.length = 0
    invalidateSnapshot()
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
    initialized = false
    commandLog.length = 0
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
    // Reset clears all terminal state, so we can discard the command log
    // and start fresh — no need to replay everything before the reset
    commandLog.length = 0
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
