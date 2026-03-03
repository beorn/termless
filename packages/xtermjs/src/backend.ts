/**
 * xterm.js backend for termless.
 *
 * Wraps @xterm/headless to implement the TerminalBackend interface,
 * providing in-process terminal emulation with no browser dependency.
 */

import { Terminal } from "@xterm/headless"
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

// ═══════════════════════════════════════════════════════
// ANSI 256-color palette
// ═══════════════════════════════════════════════════════

/** Standard 16-color ANSI palette */
const ANSI_16: readonly RGB[] = [
  { r: 0x00, g: 0x00, b: 0x00 }, // 0  Black
  { r: 0x80, g: 0x00, b: 0x00 }, // 1  Red
  { r: 0x00, g: 0x80, b: 0x00 }, // 2  Green
  { r: 0x80, g: 0x80, b: 0x00 }, // 3  Yellow
  { r: 0x00, g: 0x00, b: 0x80 }, // 4  Blue
  { r: 0x80, g: 0x00, b: 0x80 }, // 5  Magenta
  { r: 0x00, g: 0x80, b: 0x80 }, // 6  Cyan
  { r: 0xc0, g: 0xc0, b: 0xc0 }, // 7  White
  { r: 0x80, g: 0x80, b: 0x80 }, // 8  Bright Black
  { r: 0xff, g: 0x00, b: 0x00 }, // 9  Bright Red
  { r: 0x00, g: 0xff, b: 0x00 }, // 10 Bright Green
  { r: 0xff, g: 0xff, b: 0x00 }, // 11 Bright Yellow
  { r: 0x00, g: 0x00, b: 0xff }, // 12 Bright Blue
  { r: 0xff, g: 0x00, b: 0xff }, // 13 Bright Magenta
  { r: 0x00, g: 0xff, b: 0xff }, // 14 Bright Cyan
  { r: 0xff, g: 0xff, b: 0xff }, // 15 Bright White
]

/** Build the full 256-color palette (16 base + 216 cube + 24 grayscale) */
function buildPalette256(): RGB[] {
  const palette: RGB[] = [...ANSI_16]

  // 6x6x6 color cube (indices 16-231)
  const levels = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff]
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        palette.push({ r: levels[r]!, g: levels[g]!, b: levels[b]! })
      }
    }
  }

  // Grayscale ramp (indices 232-255)
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10
    palette.push({ r: v, g: v, b: v })
  }

  return palette
}

const PALETTE_256 = buildPalette256()

/** Convert a palette index (0-255) to RGB */
function paletteToRgb(index: number): RGB {
  return PALETTE_256[index] ?? { r: 0, g: 0, b: 0 }
}

/** Extract RGB from a 24-bit color value (0xRRGGBB) */
function truecolorToRgb(value: number): RGB {
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  }
}

// ═══════════════════════════════════════════════════════
// Backend factory
// ═══════════════════════════════════════════════════════

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

/**
 * Create an xterm.js backend for termless.
 *
 * Uses @xterm/headless for in-process terminal emulation — no browser needed.
 * The terminal is initialized lazily via init(), or eagerly if opts are provided.
 */
export function createXtermBackend(opts?: Partial<TerminalOptions>): TerminalBackend {
  let term: Terminal | null = null
  let title = ""
  const decoder = new TextDecoder()

  /** Access the internal write buffer for synchronous writes */
  function writeSync(t: Terminal, data: string): void {
    ;(t as any)._core._writeBuffer.writeSync(data)
  }

  function ensureTerm(): Terminal {
    if (!term) throw new Error("xterm backend not initialized — call init() first")
    return term
  }

  function init(options: TerminalOptions): void {
    if (term) term.dispose()

    term = new Terminal({
      cols: options.cols,
      rows: options.rows,
      scrollback: options.scrollbackLimit ?? 1000,
      allowProposedApi: true,
    })

    title = ""
    term.onTitleChange((t) => {
      title = t
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
    if (term) {
      term.dispose()
      term = null
    }
  }

  function feed(data: Uint8Array): void {
    const t = ensureTerm()
    // xterm.js write() is async — use internal writeSync for immediate buffer updates
    writeSync(t, decoder.decode(data))
  }

  function resize(cols: number, rows: number): void {
    ensureTerm().resize(cols, rows)
  }

  function reset(): void {
    const t = ensureTerm()
    // RIS (Reset to Initial State) escape sequence
    writeSync(t, "\x1bc")
    title = ""
  }

  function getText(): string {
    const t = ensureTerm()
    const buf = t.buffer.active
    const lines: string[] = []
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i)
      if (line) lines.push(line.translateToString(true))
    }
    return lines.join("\n")
  }

  function getTextRange(startRow: number, startCol: number, endRow: number, endCol: number): string {
    const t = ensureTerm()
    const buf = t.buffer.active
    const parts: string[] = []

    for (let row = startRow; row <= endRow; row++) {
      const line = buf.getLine(row)
      if (!line) continue

      const colStart = row === startRow ? startCol : 0
      const colEnd = row === endRow ? endCol : line.length

      parts.push(line.translateToString(true, colStart, colEnd))
    }

    return parts.join("\n")
  }

  function convertCell(bufCell: import("@xterm/headless").IBufferCell | undefined): Cell {
    if (!bufCell) {
      return {
        text: "",
        fg: null,
        bg: null,
        bold: false,
        faint: false,
        italic: false,
        underline: "none",
        strikethrough: false,
        inverse: false,
        wide: false,
      }
    }

    // Foreground color
    let fg: RGB | null = null
    if (bufCell.isFgRGB()) {
      fg = truecolorToRgb(bufCell.getFgColor())
    } else if (bufCell.isFgPalette()) {
      fg = paletteToRgb(bufCell.getFgColor())
    }

    // Background color
    let bg: RGB | null = null
    if (bufCell.isBgRGB()) {
      bg = truecolorToRgb(bufCell.getBgColor())
    } else if (bufCell.isBgPalette()) {
      bg = paletteToRgb(bufCell.getBgColor())
    }

    return {
      text: bufCell.getChars(),
      fg,
      bg,
      bold: bufCell.isBold() !== 0,
      faint: bufCell.isDim() !== 0,
      italic: bufCell.isItalic() !== 0,
      underline: bufCell.isUnderline() !== 0 ? "single" : "none",
      strikethrough: bufCell.isStrikethrough() !== 0,
      inverse: bufCell.isInverse() !== 0,
      wide: bufCell.getWidth() > 1,
    }
  }

  function getCell(row: number, col: number): Cell {
    const t = ensureTerm()
    const line = t.buffer.active.getLine(row)
    if (!line) {
      return {
        text: "",
        fg: null,
        bg: null,
        bold: false,
        faint: false,
        italic: false,
        underline: "none",
        strikethrough: false,
        inverse: false,
        wide: false,
      }
    }
    return convertCell(line.getCell(col))
  }

  function getLine(row: number): Cell[] {
    const t = ensureTerm()
    const cols = t.cols
    const cells: Cell[] = []
    for (let col = 0; col < cols; col++) {
      cells.push(getCell(row, col))
    }
    return cells
  }

  function getLines(): Cell[][] {
    const t = ensureTerm()
    const rows = t.rows
    const result: Cell[][] = []
    for (let row = 0; row < rows; row++) {
      result.push(getLine(row))
    }
    return result
  }

  function getCursor(): CursorState {
    const t = ensureTerm()
    return {
      x: t.buffer.active.cursorX,
      y: t.buffer.active.cursorY,
      visible: true, // headless xterm doesn't easily expose DECTCEM state
      style: "block", // default — headless doesn't expose cursor style
    }
  }

  function getMode(mode: TerminalMode): boolean {
    const t = ensureTerm()

    switch (mode) {
      case "altScreen":
        return t.buffer.active.type === "alternate"
      case "cursorVisible":
        return true // not easily trackable in headless
      case "bracketedPaste":
        return t.modes.bracketedPasteMode
      case "applicationCursor":
        return t.modes.applicationCursorKeysMode
      case "applicationKeypad":
        return t.modes.applicationKeypadMode
      case "autoWrap":
        return t.modes.wraparoundMode
      case "mouseTracking":
        return t.modes.mouseTrackingMode !== "none"
      case "focusTracking":
        return t.modes.sendFocusMode
      case "originMode":
        return t.modes.originMode
      case "insertMode":
        return t.modes.insertMode
      case "reverseVideo":
        return false // not exposed by xterm.js headless
    }
  }

  function getTitle(): string {
    return title
  }

  function getScrollback(): ScrollbackState {
    const t = ensureTerm()
    const buf = t.buffer.active
    return {
      viewportOffset: buf.viewportY,
      totalLines: buf.length,
      screenLines: t.rows,
    }
  }

  function scrollViewport(delta: number): void {
    ensureTerm().scrollLines(delta)
  }

  const capabilities: TerminalCapabilities = {
    name: "xterm",
    version: "5.5.0",
    truecolor: true,
    kittyKeyboard: false,
    kittyGraphics: false,
    sixel: false,
    osc8Hyperlinks: true,
    semanticPrompts: false,
    unicode: "15.1",
    reflow: true,
    extensions: new Set(),
  }

  return {
    name: "xterm",
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
