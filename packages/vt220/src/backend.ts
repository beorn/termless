/**
 * Pure TypeScript VT220 backend for termless.
 *
 * Wraps the vt220.js screen emulator to implement the TerminalBackend interface.
 * Extends VT100 with 8 standard colors, insert/delete characters/lines,
 * insert mode (IRM), selective erase (DECSED/DECSEL), and soft reset (DECSTR).
 */

import { createVt220Screen as createScreen, type Vt220Screen as Screen } from "vt220.js"
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

  function getCell(row: number, col: number): Cell {
    const sc = ensureScreen().getCell(row, col)
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

  function getLine(row: number): Cell[] {
    return ensureScreen()
      .getLine(row)
      .map((sc) => ({
        char: sc.char,
        fg: sc.fg,
        bg: sc.bg,
        bold: sc.bold,
        dim: false,
        italic: false,
        underline: sc.underline ? ("single" as const) : false,
        underlineColor: null,
        strikethrough: false,
        inverse: sc.inverse,
        blink: sc.blink,
        hidden: sc.hidden,
        wide: false,
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
    name: "vt220",
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
