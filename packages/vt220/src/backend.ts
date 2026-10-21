/**
 * Pure TypeScript VT220 backend for termless.
 *
 * Wraps the vt220.js screen emulator to implement the TerminalBackend interface.
 * Extends VT100 with 8 standard colors, insert/delete characters/lines,
 * insert mode (IRM), selective erase (DECSED/DECSEL), and soft reset (DECSTR).
 */

import { createVt220Screen as createScreen, type ScreenCell, type Vt220Screen as Screen } from "vt220.js"
import type {
  TerminalBackend,
  TerminalOptions,
  Cell,
  Cursor,
  TerminalMode,
  ScrollbackState,
  TerminalCapabilities,
} from "../../../src/terminal/types.ts"
import { encodeKeyToAnsi } from "../../../src/terminal/key-encoding.ts"

// ═══════════════════════════════════════════════════════
// Backend factory
// ═══════════════════════════════════════════════════════

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

/**
 * Create a pure TypeScript VT220 backend for termless.
 *
 * Extends VT100 with: 8 standard colors (SGR 30-37/40-47), insert mode (IRM),
 * insert/delete characters (ICH/DCH), insert/delete lines (IL/DL),
 * erase characters (ECH), selective erase (DECSED/DECSEL), hidden/conceal
 * (SGR 8/28), and soft reset (DECSTR). No truecolor, no 256 colors, no wide
 * chars — use vterm.js for those.
 */
export function createVt220Backend(opts?: Partial<TerminalOptions>): TerminalBackend {
  let screen: Screen | null = null

  function ensureScreen(): Screen {
    if (!screen) throw new Error("vt220 backend not initialized — call init() first")
    return screen
  }

  function init(options: TerminalOptions): void {
    screen = createScreen({
      cols: options.cols,
      rows: options.rows,
      scrollbackLimit: options.scrollbackLimit ?? 1000,
      onResponse: (data: string) => {
        if (backend.onResponse) {
          backend.onResponse(new TextEncoder().encode(data))
        }
      },
    })
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
    screen = null
  }

  // CSI 18t = text-area cell-size query; reply CSI 8;rows;cols t derived
  // from engine screen dimensions (`s.rows` / `s.cols`), emitted in input order.
  // Split raw bytes without decoding so multi-byte UTF-8 sequences split across
  // chunks continue through vt220.js's streaming decoder intact.
  function findCsi18t(data: Uint8Array, fromIndex: number): number {
    for (let i = fromIndex; i <= data.length - 5; i++) {
      if (
        data[i] === 0x1b &&
        data[i + 1] === 0x5b &&
        data[i + 2] === 0x31 &&
        data[i + 3] === 0x38 &&
        data[i + 4] === 0x74
      ) {
        return i
      }
    }
    return -1
  }

  function feed(data: Uint8Array): void {
    const s = ensureScreen()
    const first = findCsi18t(data, 0)
    if (first === -1) {
      s.process(data)
      return
    }
    const enc = new TextEncoder()
    let cursor = 0
    let match = first
    while (match !== -1) {
      if (match > cursor) {
        s.process(data.subarray(cursor, match))
      }
      backend.onResponse?.(enc.encode(`\x1b[8;${s.rows};${s.cols}t`))
      cursor = match + 5
      match = findCsi18t(data, cursor)
    }
    if (cursor < data.length) {
      s.process(data.subarray(cursor))
    }
  }

  function resize(cols: number, rows: number): void {
    ensureScreen().resize(cols, rows)
  }

  function reset(): void {
    ensureScreen().reset()
  }

  function emptyCell(): Cell {
    return {
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
  }

  function convertCell(sc: ScreenCell): Cell {
    return {
      char: sc.char,
      fg: sc.fg,
      bg: sc.bg,
      bold: sc.bold,
      dim: false,
      italic: false,
      underline: sc.underline ? "single" : false,
      underlineColor: null,
      strikethrough: false,
      inverse: sc.inverse,
      blink: sc.blink,
      hidden: sc.hidden,
      wide: false,
      continuation: false,
      hyperlink: null,
    }
  }

  function snapshotRows(): Cell[][] {
    const snap = ensureScreen().snapshot()
    const rows: Cell[][] = new Array(snap.scrollback.length + snap.grid.length)
    for (let row = 0; row < snap.scrollback.length; row++) {
      rows[row] = snap.scrollback[row]!.map(convertCell)
    }
    for (let row = 0; row < snap.grid.length; row++) {
      rows[snap.scrollback.length + row] = snap.grid[row]!.map(convertCell)
    }
    return rows
  }

  function getText(): string {
    return snapshotRows()
      .map((row) => row.map((cell) => cell.char || " ").join(""))
      .join("\n")
  }

  function getTextRange(startRow: number, startCol: number, endRow: number, endCol: number): string {
    const rows = snapshotRows()
    const parts: string[] = []
    for (let row = startRow; row <= endRow; row++) {
      const cells = rows[row]
      if (!cells) continue
      const start = row === startRow ? startCol : 0
      const end = row === endRow ? endCol : cells.length
      parts.push(
        cells
          .slice(start, end)
          .map((cell) => cell.char || " ")
          .join("")
          .replace(/\s+$/, ""),
      )
    }
    return parts.join("\n")
  }

  function getCell(row: number, col: number): Cell {
    return getLine(row)[col] ?? emptyCell()
  }

  function getLine(row: number): Cell[] {
    return snapshotRows()[row] ?? Array.from({ length: ensureScreen().cols }, () => emptyCell())
  }

  function getLines(): Cell[][] {
    return snapshotRows()
  }

  function getCursor(): Cursor {
    const s = ensureScreen()
    const pos = s.getCursorPosition()
    return {
      col: pos.x,
      row: pos.y,
      x: pos.x,
      y: pos.y,
      visible: s.getCursorVisible(),
      style: "block",
    }
  }

  function getMode(mode: TerminalMode): boolean {
    return ensureScreen().getMode(mode)
  }

  function getTitle(): string {
    return ensureScreen().getTitle()
  }

  function getScrollback(): ScrollbackState {
    const s = ensureScreen()
    const scrollbackLength = s.getScrollbackLength()
    const relativeOffset = s.getViewportOffset()
    return {
      viewportTop: scrollbackLength - relativeOffset,
      totalRows: scrollbackLength + s.rows,
      screenRows: s.rows,
      viewportOffset: scrollbackLength - relativeOffset,
      totalLines: scrollbackLength + s.rows,
      screenLines: s.rows,
    }
  }

  function scrollViewport(delta: number): void {
    ensureScreen().scrollViewport(delta)
  }

  const capabilities: TerminalCapabilities = {
    name: "vt220",
    version: "0.7.1",
    truecolor: false,
    kittyKeyboard: false,
    kittyGraphics: false,
    sixel: false,
    osc8Hyperlinks: false,
    semanticPrompts: false,
    unicode: "1.0",
    reflow: false,
    extensions: new Set(),
  }

  const backend: TerminalBackend = {
    name: "vt220",
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
    getRow: getLine,
    getRows: getLines,
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
