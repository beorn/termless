/**
 * Pure TypeScript VT100 backend for termless.
 *
 * Wraps the internal screen emulator to implement the TerminalBackend interface.
 * Zero external dependencies — all VT100/ANSI parsing is done in pure TypeScript,
 * inspired by the Rust vt100 crate's design.
 */

import { createVt100Screen as createScreen, type Vt100Screen as Screen } from "vt100.js"
import type {
  TerminalBackend,
  TerminalOptions,
  Cell,
  CursorState,
  TerminalMode,
  ScrollbackState,
  TerminalCapabilities,
} from "../../../src/types.ts"
import { encodeKeyToAnsi } from "../../../src/key-encoding.ts"

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
 * Supports: SGR (16/256/truecolor), cursor movement, erase commands,
 * scroll regions, alternate screen, bracketed paste, mouse tracking,
 * OSC title, and more.
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

  function feed(data: Uint8Array): void {
    ensureScreen().process(data)
  }

  function resize(cols: number, rows: number): void {
    ensureScreen().resize(cols, rows)
  }

  function reset(): void {
    ensureScreen().reset()
  }

  function getText(): string {
    return ensureScreen().getText()
  }

  function getTextRange(startRow: number, startCol: number, endRow: number, endCol: number): string {
    return ensureScreen().getTextRange(startRow, startCol, endRow, endCol)
  }

  /** Map vt100 screen underline ("none"|"single"|...) to Cell underline (false|"single"|...) */
  function mapUnderline(u: import("vt100.js").UnderlineStyle): Cell["underline"] {
    return u === "none" ? false : u
  }

  function getCell(row: number, col: number): Cell {
    const sc = ensureScreen().getCell(row, col)
    return {
      char: sc.char,
      fg: sc.fg,
      bg: sc.bg,
      bold: sc.bold,
      dim: sc.faint,
      italic: sc.italic,
      underline: mapUnderline(sc.underline),
      underlineColor: null,
      strikethrough: sc.strikethrough,
      inverse: sc.inverse,
      blink: false,
      hidden: false,
      wide: sc.wide,
      continuation: false,
      hyperlink: null,
    }
  }

  function getLine(row: number): Cell[] {
    return ensureScreen()
      .getLine(row)
      .map((sc) => ({
        char: sc.char,
        fg: sc.fg,
        bg: sc.bg,
        bold: sc.bold,
        dim: sc.faint,
        italic: sc.italic,
        underline: mapUnderline(sc.underline),
        underlineColor: null,
        strikethrough: sc.strikethrough,
        inverse: sc.inverse,
        blink: false,
        hidden: false,
        wide: sc.wide,
        continuation: false,
        hyperlink: null,
      }))
  }

  function getLines(): Cell[][] {
    const s = ensureScreen()
    const result: Cell[][] = []
    for (let row = 0; row < s.rows; row++) {
      result.push(getLine(row))
    }
    return result
  }

  function getCursor(): CursorState {
    const s = ensureScreen()
    const pos = s.getCursorPosition()
    return {
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
    truecolor: true,
    kittyKeyboard: false,
    kittyGraphics: false,
    sixel: false,
    osc8Hyperlinks: false,
    semanticPrompts: false,
    unicode: "15.1",
    reflow: false, // No reflow support in pure TS implementation
    extensions: new Set(),
  }

  // TODO: vt100.js is a minimal VT100-era parser that doesn't generate DA1/DA2/DSR responses.
  // The sister library vterm.js supports this via its onResponse callback.
  // When response generation is added to vt100.js, wire it here like vterm does.

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
