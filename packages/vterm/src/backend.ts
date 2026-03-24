/**
 * Full-featured vterm.js backend for termless.
 *
 * Wraps the vterm.js terminal emulator to implement the TerminalBackend interface.
 * Zero external dependencies — all VT/ECMA-48/xterm parsing is done in pure TypeScript.
 * Supports every SGR attribute, cursor shapes, OSC 8 hyperlinks, and more.
 */

import { createVtermScreen as createScreen, type VtermScreen as Screen } from "vterm.js"
import type {
  TerminalBackend,
  TerminalOptions,
  Cell,
  CursorState,
  CursorStyle,
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
 * Create a full-featured vterm.js backend for termless.
 *
 * This is a comprehensive terminal emulator targeting 100% coverage of
 * the terminfo.dev feature matrix. Pure TypeScript, zero dependencies.
 *
 * Supports: All SGR attributes (bold, faint, italic, underline styles,
 * overline, strikethrough, blink, hidden, inverse), 16/256/truecolor,
 * underline color, cursor shapes (DECSCUSR), OSC 8 hyperlinks, all DEC
 * private modes, DA1/DA2/DSR responses, synchronized output, and more.
 */
export function createVtermBackend(opts?: Partial<TerminalOptions>): TerminalBackend {
  let screen: Screen | null = null

  function ensureScreen(): Screen {
    if (!screen) throw new Error("vterm backend not initialized — call init() first")
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

  /** Map vterm screen underline ("none"|"single"|...) to Cell underline (false|"single"|...) */
  function mapUnderline(u: import("vterm.js").UnderlineStyle): Cell["underline"] {
    return u === "none" ? false : u
  }

  /** Map vterm cursor shape to termless CursorStyle */
  function mapCursorShape(shape: "block" | "underline" | "bar"): CursorStyle {
    if (shape === "bar") return "beam"
    return shape
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
      underlineColor: sc.underlineColor,
      strikethrough: sc.strikethrough,
      inverse: sc.inverse,
      blink: sc.blink,
      hidden: sc.hidden,
      wide: sc.wide,
      continuation: false,
      hyperlink: sc.url,
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
        underlineColor: sc.underlineColor,
        strikethrough: sc.strikethrough,
        inverse: sc.inverse,
        blink: sc.blink,
        hidden: sc.hidden,
        wide: sc.wide,
        continuation: false,
        hyperlink: sc.url,
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
      style: mapCursorShape(s.getCursorShape()),
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
    name: "vterm",
    version: "0.1.0",
    truecolor: true,
    kittyKeyboard: false,
    kittyGraphics: false,
    sixel: false,
    osc8Hyperlinks: true,
    semanticPrompts: false,
    unicode: "15.1",
    reflow: false,
    extensions: new Set(),
  }

  return {
    name: "vterm",
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
