/**
 * Pure TypeScript VT100 backend for termless.
 *
 * Wraps the internal screen emulator to implement the TerminalBackend interface.
 * Zero external dependencies — all VT100/ANSI parsing is done in pure TypeScript,
 * inspired by the Rust vt100 crate's design.
 */

import { createVt100Screen as createScreen, type ScreenCell, type Vt100Screen as Screen } from "vt100.js"
import type {
  TerminalBackend,
  TerminalOptions,
  Cell,
  CursorState,
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
export function createVt100Backend(opts?: Partial<TerminalOptions>): TerminalBackend {
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

  /**
   * Standard cell metrics used for synthetic CSI 14t / 18t window-op
   * responses. The pure-TypeScript vt100 emulator has no window-pixel
   * concept, so we synthesize 14t/18t from `screen.rows × screen.cols ×
   * typical cell metrics`. silvery's `resolveMouseOption()` divides
   * pixel coords by cell metrics to recover cell coords for SGR-Pixels
   * (1016) mouse hit-testing. 8 × 17 is the typical Iosevka/JetBrains
   * Mono cell at 12pt 96 DPI — what matters is the ratio matches the
   * backend's cell grid (one cell = one cell, invariant).
   */
  const CELL_W_PX = 8
  const CELL_H_PX = 17

  // CSI 14t = text-area pixel-size query; reply CSI 4;h;w t
  // CSI 18t = text-area cell-size query; reply CSI 8;h;w t
  const CSI_14t_RE = /\x1b\[14t/g
  const CSI_18t_RE = /\x1b\[18t/g

  function feed(data: Uint8Array): void {
    const s = ensureScreen()
    s.process(data)

    if (backend.onResponse) {
      const text = new TextDecoder().decode(data)
      CSI_14t_RE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = CSI_14t_RE.exec(text)) !== null) {
        const heightPx = s.rows * CELL_H_PX
        const widthPx = s.cols * CELL_W_PX
        backend.onResponse(new TextEncoder().encode(`\x1b[4;${heightPx};${widthPx}t`))
      }
      CSI_18t_RE.lastIndex = 0
      while ((m = CSI_18t_RE.exec(text)) !== null) {
        backend.onResponse(new TextEncoder().encode(`\x1b[8;${s.rows};${s.cols}t`))
      }
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
      parts.push(cells.slice(start, end).map((cell) => cell.char || " ").join("").replace(/\s+$/, ""))
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

  function getCursor(): CursorState {
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
    version: "0.1.0",
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
  }

  return backend
}
