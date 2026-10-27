/**
 * Pure TypeScript VT100 backend for termless.
 *
 * Wraps the internal screen emulator to implement the TerminalBackend interface.
 * Zero external dependencies — all VT100/ANSI parsing is done in pure TypeScript,
 * inspired by the Rust vt100 crate's design.
 */

import { replyDelivery } from "./reply-delivery.ts"
import { createVt100Screen as createScreen, type ScreenCell, type Vt100Screen as Screen } from "vt100.js"
import type {
  TerminalBackend,
  ReplyDeliveryExtension,
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
 * Create a pure TypeScript VT100 backend for termless.
 *
 * This is a lightweight, zero-dependency terminal emulator inspired by
 * the Rust vt100 crate. It parses ANSI/VT100 escape sequences and
 * maintains an in-memory screen representation with per-cell attributes.
 *
 * Supports: SGR (8 standard colors, bold, underline, blink, reverse, hidden),
 * cursor movement, erase commands, scroll regions, DA1/DSR responses,
 * OSC title, and more. No truecolor, no 256 colors, no wide chars — use
 * vterm.js for those.
 */
export function createVt100Backend(opts?: Partial<TerminalOptions>): TerminalBackend & ReplyDeliveryExtension {
  let screen: Screen | null = null

  function ensureScreen(): Screen {
    if (!screen) throw new Error("vt100 backend not initialized — call init() first")
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
  // chunks continue through vt100.js's streaming decoder intact.
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

  function absoluteLine(row: number): ScreenCell[] | undefined {
    const s = ensureScreen()
    const scrollbackLength = s.getScrollbackLength()
    if (row < 0 || row >= scrollbackLength + s.rows) return undefined
    return row < scrollbackLength ? s.getScrollbackLine(row) : s.getLine(row - scrollbackLength)
  }

  function getText(): string {
    const s = ensureScreen()
    const lines: string[] = []
    for (let row = 0; row < s.getScrollbackLength() + s.rows; row++) {
      lines.push(
        getLine(row)
          .map((cell) => cell.char || " ")
          .join("")
          .replace(/\s+$/, ""),
      )
    }
    return lines.join("\n")
  }

  function getTextRange(startRow: number, startCol: number, endRow: number, endCol: number): string {
    const parts: string[] = []
    for (let row = startRow; row <= endRow; row++) {
      const cells = getLine(row)
      if (cells.length === 0) continue
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
    const cells = absoluteLine(row)
    if (!cells) {
      const s = ensureScreen()
      return Array.from({ length: s.cols }, () => emptyCell())
    }
    return cells.map(convertCell)
  }

  function getLines(): Cell[][] {
    const result: Cell[][] = []
    const totalRows = ensureScreen().getScrollbackLength() + ensureScreen().rows
    for (let row = 0; row < totalRows; row++) {
      result.push(getLine(row))
    }
    return result
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
    // Convert relative offset (lines from bottom) to absolute viewport top row.
    // At bottom (relativeOffset=0): absolute = scrollbackLength (= totalLines - screenLines)
    // Scrolled up by N: absolute = scrollbackLength - N
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
    name: "vt100",
    version: "0.7.1",
    truecolor: false,
    kittyKeyboard: false,
    kittyGraphics: false,
    sixel: false,
    osc8Hyperlinks: false,
    semanticPrompts: false,
    unicode: "1.0",
    reflow: false,
    extensions: new Set(["reply-delivery"]),
  }

  const backend: TerminalBackend & ReplyDeliveryExtension = {
    name: "vt100",
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
    replyDelivery,
  }

  return backend
}
