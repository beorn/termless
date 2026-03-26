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
      onResponse: (data: string) => {
        // Forward DA1/DA2/DSR responses to the terminal layer
        if (backend.onResponse) {
          backend.onResponse(new TextEncoder().encode(data))
        }
      },
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
    version: "0.2.0",

    // Genuinely implemented: parses RGB values, stores on cells, resolves palette
    truecolor: true,

    // Protocol-level support: full push/pop/query state machine (CSI > u / < u / ? u).
    // Flags are stored and queryable; actual key encoding uses them in the host layer
    // (encodeKeyToAnsi reads the mode from the backend).
    kittyKeyboard: true,

    // Protocol-level support: parses APC G sequences, responds to queries with OK.
    // Does not store or render image data — there's no pixel framebuffer in a headless
    // emulator. The handshake works, so apps that probe before sending images get a
    // truthful "I accept this protocol" answer.
    kittyGraphics: true,

    // Parses sixel DCS sequences and preserves raw data via getSixelImages().
    // A host (GUI renderer, test harness) can consume the stored data. No pixel
    // decoding is done — that's the host's job. DA1 reports attribute 4 (sixel)
    // so applications that check before sending sixel data will proceed correctly.
    sixel: true,

    // Genuinely implemented: stores URL on cell attributes via OSC 8
    osc8Hyperlinks: true,

    // Genuinely implemented: stores zone markers (prompt/command/output) from OSC 133/633
    semanticPrompts: true,

    unicode: "15.1",

    // Genuinely implemented: full reflow algorithm with soft-wrap tracking on resize
    reflow: true,

    extensions: new Set(),
  }

  const backend: TerminalBackend = {
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

  // Eagerly init if opts provided
  if (opts) {
    backend.init({
      cols: opts.cols ?? DEFAULT_COLS,
      rows: opts.rows ?? DEFAULT_ROWS,
      scrollbackLimit: opts.scrollbackLimit,
    })
  }

  return backend
}
