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
/* oxlint-disable typescript/no-deprecated -- This adapter still implements the required TerminalBackend compatibility contract until unterm A4. */

import type {
  TerminalBackend,
  TerminalOptions,
  Cell,
  Cursor,
  TerminalMode,
  ScrollbackState,
  TerminalCapabilities,
  Color,
  EmulatorWarning,
  ReplyDeliveryExtension,
  WarningExtension,
  HyperlinkExtension,
} from "../../../src/terminal/types.ts"
import { declaredPixelGeometry } from "../../../src/terminal/types.ts"
import { encodeKeyToAnsi } from "../../../src/terminal/key-encoding.ts"
import { replyDelivery } from "./reply-delivery.ts"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
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
  const explicit = process.env.KITTY_BINARY
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`KITTY_BINARY does not exist: ${explicit}`)
    return explicit
  }
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
  hyperlink: string | null
  fg: [number, number, number] | null
  bg: [number, number, number] | null
  bold: boolean
  dim: boolean
  italic: boolean
  underline: string
  underlineColor: [number, number, number] | null
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
  /** Base64-encoded DA1/DA2/DSR response data accumulated during replay */
  responses?: string
  /** Window callbacks the replay reached that the bridge does not reproduce, in feed order */
  unreproduced?: string[]
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
  if (cell.hyperlink !== null && typeof cell.hyperlink !== "string") {
    throw new Error("Kitty bridge cell hyperlink must be a string or null")
  }
  const fg: Color | null = cell.fg ? { r: cell.fg[0], g: cell.fg[1], b: cell.fg[2] } : null
  const bg: Color | null = cell.bg ? { r: cell.bg[0], g: cell.bg[1], b: cell.bg[2] } : null
  if (
    cell.underlineColor !== null &&
    (!Array.isArray(cell.underlineColor) ||
      cell.underlineColor.length !== 3 ||
      !cell.underlineColor.every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255))
  ) {
    throw new Error("Kitty bridge underlineColor must be an RGB triple or null")
  }
  const underlineColor: Color | null =
    cell.underlineColor === null
      ? null
      : {
          r: cell.underlineColor[0],
          g: cell.underlineColor[1],
          b: cell.underlineColor[2],
        }

  return {
    char: cell.text,
    fg,
    bg,
    bold: cell.bold,
    dim: cell.dim,
    italic: cell.italic,
    underline: cell.underline === "none" ? false : (cell.underline as Cell["underline"]),
    underlineColor,
    strikethrough: cell.strikethrough,
    inverse: cell.inverse,
    blink: cell.blink ?? false,
    overline: null,
    hidden: false,
    wide: cell.wide,
    continuation: false,
    hyperlink: cell.hyperlink,
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
  overline: null,
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
  // An explicit measurement target is required; never turn a bad path into a skip.
  if (process.env.KITTY_BINARY) {
    findKitty()
    return true
  }
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
export function createKittyBackend(
  opts?: Partial<TerminalOptions>,
): TerminalBackend & WarningExtension & ReplyDeliveryExtension & HyperlinkExtension {
  let cols = DEFAULT_COLS
  let rows = DEFAULT_ROWS
  let scrollbackLimit = 1000
  let initialized = false

  // Command log — accumulated mutations replayed on query
  let commandLog: BridgeCommand[] = []

  // Cached snapshot from last query
  let snapshot: BridgeSnapshot | null = null

  // Batch replay includes every earlier response. Keep the observed prefix so
  // a later snapshot only delivers replies generated since the previous one.
  let observedResponses = Buffer.alloc(0)
  let observedUnreproduced: string[] = []
  const warnings: EmulatorWarning[] = []
  let kittyConfigDir: string | null = null

  function ensureKittyConfigDir(): string {
    if (process.env.KITTY_CONFIG_DIRECTORY) {
      return process.env.KITTY_CONFIG_DIRECTORY
    }
    if (!kittyConfigDir) {
      kittyConfigDir = mkdtempSync(join(tmpdir(), "termless-kitty-config-"))
    }
    return kittyConfigDir
  }

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
        env: {
          ...process.env,
          KITTY_CONFIG_DIRECTORY: ensureKittyConfigDir(),
        },
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
    const nextSnapshot = replayAndSnapshot()

    const responseBytes = nextSnapshot.responses ? Buffer.from(nextSnapshot.responses, "base64") : Buffer.alloc(0)
    if (!responseBytes.subarray(0, observedResponses.length).equals(observedResponses)) {
      throw new Error("Kitty bridge changed an earlier response during batch replay")
    }
    const newResponses = responseBytes.subarray(observedResponses.length)
    const unreproduced = nextSnapshot.unreproduced ?? []
    if (observedUnreproduced.some((callback, index) => unreproduced[index] !== callback)) {
      throw new Error("Kitty bridge changed an earlier unreproduced callback during batch replay")
    }
    // A reply this bridge cannot produce is a harness gap, never the terminal's silence.
    for (const callback of unreproduced.slice(observedUnreproduced.length)) {
      warnings.push({ code: "UNREPRODUCED_CALLBACK", message: callback, backend: "kitty" })
    }
    snapshot = nextSnapshot
    observedResponses = responseBytes
    observedUnreproduced = unreproduced
    if (backend.onResponse && newResponses.length > 0) {
      backend.onResponse(new Uint8Array(newResponses))
    }

    return snapshot
  }

  function init(options: TerminalOptions): void {
    // The bridge hands Kitty's Screen this cell size; none declared keeps its 0x0 cell.
    const geometry = declaredPixelGeometry("kitty", options)
    cols = options.cols
    rows = options.rows
    scrollbackLimit = options.scrollbackLimit ?? 1000

    // Reset command log with init as the first command
    commandLog = [{ op: "init", cols, rows, scrollbackLimit, ...geometry }]
    initialized = true
    snapshot = null
    observedResponses = Buffer.alloc(0)
    observedUnreproduced = []
  }

  // Eagerly init if opts provided
  if (opts) {
    init({
      cols: opts.cols ?? DEFAULT_COLS,
      rows: opts.rows ?? DEFAULT_ROWS,
      scrollbackLimit: opts.scrollbackLimit,
      pixelGeometry: opts.pixelGeometry,
    })
  }

  function destroy(): void {
    commandLog = []
    initialized = false
    snapshot = null
    observedResponses = Buffer.alloc(0)
    observedUnreproduced = []
    if (kittyConfigDir) {
      rmSync(kittyConfigDir, { recursive: true, force: true })
      kittyConfigDir = null
    }
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
      if (!cellRow) throw new Error(`Kitty bridge omitted cell row ${row}`)
      const colStart = row === startRow ? startCol : 0
      const colEnd = row === endRow ? endCol : cols
      let line = ""
      for (let col = colStart; col < colEnd && col < cellRow.length; col++) {
        const cell = cellRow[col]
        if (!cell) throw new Error(`Kitty bridge omitted cell ${row},${col}`)
        const text = cell.text
        line += text || " "
      }
      lines.push(line.trimEnd())
    }
    return lines.join("\n")
  }

  function getCell(row: number, col: number): Cell {
    const s = ensureSnapshot()
    if (row >= s.cells.length) {
      return EMPTY_CELL
    }
    const cellRow = s.cells[row]
    if (!cellRow) throw new Error(`Kitty bridge omitted cell row ${row}`)
    if (col >= cellRow.length) return EMPTY_CELL
    const cell = cellRow[col]
    if (!cell) throw new Error(`Kitty bridge omitted cell ${row},${col}`)
    return convertBridgeCell(cell)
  }

  function getLine(row: number): Cell[] {
    const s = ensureSnapshot()
    if (row >= s.cells.length) {
      return Array.from({ length: cols }, () => EMPTY_CELL)
    }
    const cellRow = s.cells[row]
    if (!cellRow) throw new Error(`Kitty bridge omitted cell row ${row}`)
    return cellRow.map(convertBridgeCell)
  }

  function getLines(): Cell[][] {
    const s = ensureSnapshot()
    return s.cells.map((row) => row.map(convertBridgeCell))
  }

  function getCursor(): Cursor {
    const s = ensureSnapshot()
    return {
      col: s.cursor.x,
      row: s.cursor.y,
      x: s.cursor.x,
      y: s.cursor.y,
      visible: s.cursor.visible,
      style: (s.cursor.style as Cursor["style"]) ?? "block",
    }
  }

  function getMode(mode: TerminalMode): boolean {
    const s = ensureSnapshot()
    return (s.modes[mode] ?? null) as unknown as boolean
  }

  function getTitle(): string {
    const s = ensureSnapshot()
    return s.title
  }

  function getScrollback(): ScrollbackState {
    const s = ensureSnapshot()
    return {
      viewportTop: s.scrollback.viewportOffset,
      totalRows: s.scrollback.totalLines,
      screenRows: s.scrollback.screenLines,
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
    version: "0.49.2",
    truecolor: true,
    kittyKeyboard: true,
    kittyGraphics: true,
    sixel: false,
    osc8Hyperlinks: true,
    semanticPrompts: false,
    unicode: "15.1",
    reflow: true,
    extensions: new Set(["warnings", "reply-delivery", "hyperlinks"]),
  }

  // onResponse is wired: bridge.py captures DA1/DA2/DSR responses via the
  // Callbacks.write() method (which kitty's VT parser calls for terminal output).
  // Responses accumulate during batch replay and are included in the snapshot
  // JSON as base64-encoded "responses" field. They are forwarded to
  // backend.onResponse when ensureSnapshot() is called.
  //
  // Note: Due to kitty's batch-replay architecture, responses are delivered
  // lazily (on next query) rather than immediately after feed(). This is fine
  // for testing but may cause timing issues with interactive PTY usage.

  const backend: TerminalBackend & WarningExtension & ReplyDeliveryExtension & HyperlinkExtension = {
    name: "kitty",
    init,
    destroy,
    feed,
    resize,
    reset,
    getText,
    getTextRange,
    getCell,
    getHyperlinkAt: (row, col) => getCell(row, col).hyperlink,
    getLine,
    getLines,
    getRow: getLine,
    getRows: getLines,
    getCursor,
    getMode,
    getTitle,
    getScrollback,
    scrollViewport,
    encodeKey: encodeKeyToAnsi,
    capabilities,
    getWarnings: () => [...warnings],
    clearWarnings: () => {
      warnings.length = 0
    },
    replyDelivery,
  }

  return backend
}
