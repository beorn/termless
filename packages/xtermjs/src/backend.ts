/**
 * xterm.js backend for termless.
 *
 * Wraps @xterm/headless to implement the TerminalBackend interface,
 * providing in-process terminal emulation with no browser dependency.
 */

// @xterm/headless is CJS — use default import for Node.js ESM compat
import xterm from "@xterm/headless"
const { Terminal } = xterm
type XTerminal = InstanceType<typeof Terminal>

// Unicode V11 addon: treats most emoji + many extended-grapheme codepoints as
// wide (2-cell). Without it, xterm.js defaults to Unicode V6 wcwidth, where
// many emoji are narrow (1-cell). Real modern terminals (Ghostty, iTerm 3.5+,
// Alacritty 0.13+) use V11+ — and they emit byte streams assuming the parser
// agrees. The mismatch produces visible duplication: when a TUI re-renders a
// row containing an emoji, each render advances the cursor by 2 cells (V11)
// but xterm.js advances by 1 (V6), so subsequent writes land at different
// columns and the cumulative buffer state shows the emoji repeated in
// adjacent cells. Loading + activating V11 fixes this.
import { Unicode11Addon } from "@xterm/addon-unicode11"
import type {
  TerminalBackend,
  TerminalOptions,
  Cell,
  CursorState,
  TerminalMode,
  ScrollbackState,
  TerminalCapabilities,
  RGB,
} from "../../../src/terminal/types.ts"
import { encodeKeyToAnsi } from "../../../src/terminal/key-encoding.ts"

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
  let term: XTerminal | null = null
  let title = ""
  let decoder = new TextDecoder()

  /** Access the internal write buffer for synchronous writes */
  function writeSync(t: XTerminal, data: string): void {
    ;(t as any)._core._writeBuffer.writeSync(data)
  }

  function ensureTerm(): XTerminal {
    if (!term) throw new Error("xterm backend not initialized — call init() first")
    return term
  }

  function init(options: TerminalOptions): void {
    if (term) term.dispose()
    decoder = new TextDecoder()

    term = new Terminal({
      cols: options.cols,
      rows: options.rows,
      scrollback: options.scrollbackLimit ?? 1000,
      allowProposedApi: true,
      // Answer CSI 18t (text-area size in cells) — xterm.js has a default
      // implementation that returns the configured rows/cols. We add 14t
      // (text-area pixel size) via our feed() intercept below since
      // xterm.js headless has no real window pixel size to report.
      windowOptions: {
        getWinSizeChars: true,
        getCellSizePixels: true,
      },
    })

    // Activate Unicode V11 wcwidth so wide emoji (📋📄💡⚠️📁 etc) advance the
    // cursor by 2 cells, matching real modern terminals. Default is V6 which
    // classifies many emoji as narrow — see import comment above for the
    // failure mode that motivated this.
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = "11"

    title = ""
    term.onTitleChange((t: string) => {
      title = t
    })

    // Forward DA1/DA2/DSR + window-op responses to the terminal layer
    term.onData((data: string) => {
      if (backend.onResponse) {
        backend.onResponse(new TextEncoder().encode(data))
      }
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

  /**
   * Standard cell metrics used for the synthetic 14t (text-area pixel
   * size) response. xterm.js headless has no real window, so it can't
   * report pixel dimensions on its own. Real terminals (xterm.js in
   * VSCode, Ghostty, etc.) answer CSI 14t with the actual rendered
   * text-area pixel size — silvery's `resolveMouseOption()` divides
   * pixel dims by cell dims to obtain cell size for SGR-Pixels (1016)
   * mouse coordinate translation.
   *
   * 8 × 17 is the typical Iosevka/JetBrains Mono cell at 12pt on a 96 DPI
   * display. The exact value isn't load-bearing — what matters is the
   * ratio matches the backend's cell grid, which is invariant for a
   * headless emulator (one cell = one cell).
   */
  const CELL_W_PX = 8
  const CELL_H_PX = 17

  /** Intercept CSI 14t (text-area pixel size query). xterm.js's
   *  windowOptions.getWinSizePixels has a default implementation that
   *  returns 0;0 in headless contexts (no real window), which silvery
   *  rejects via its isSanePositive guard. Synthesize a sensible
   *  response from the configured rows/cols × standard cell metrics. */
  const CSI_14t_RE = /\x1b\[14t/g

  function feed(data: Uint8Array): void {
    const t = ensureTerm()
    const text = decoder.decode(data, { stream: true })

    // Synthesize 14t responses out-of-band BEFORE writing the bytes to
    // xterm.js (which would drop them as unhandled when the default
    // implementation reports 0;0).
    if (backend.onResponse && CSI_14t_RE.test(text)) {
      // Reset lastIndex — regex is /g, so a prior test() may leave state
      CSI_14t_RE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = CSI_14t_RE.exec(text)) !== null) {
        const heightPx = t.rows * CELL_H_PX
        const widthPx = t.cols * CELL_W_PX
        backend.onResponse(new TextEncoder().encode(`\x1b[4;${heightPx};${widthPx}t`))
      }
    }

    // xterm.js write() is async — use internal writeSync for immediate buffer updates
    writeSync(t, text)
  }

  function resize(cols: number, rows: number): void {
    const t = ensureTerm()
    const oldCols = t.cols
    t.resize(cols, rows)
    // On a width DECREASE, xterm.js does NOT truncate the ALT-screen grid the way
    // real terminals + @termless/ghostty-native do — over-wide rows keep their
    // stale cells. A full-width *styled* row (e.g. a fullscreen TUI's bg fill)
    // then reports a width past `cols` forever, because `translateToString(true)`
    // won't trim styled trailing cells. Clear cells in [cols, oldCols) so the
    // headless emulator matches real-terminal alt-grid truncation. Shrink-only;
    // growth and equal-width are untouched. (Bead 20335 — the dogfood-19738
    // `waitNoOverflow` 12s timeout; fix belongs here, NOT in silvery's output
    // phase, where the only residue-clearing escape `\x1b[2J` was deliberately
    // removed by the 20297 pane-flicker fix.)
    if (cols < oldCols) clampActiveBufferWidth(t, cols, oldCols)
  }

  /**
   * Clear each active-buffer line's cells in [cols, oldCols) via the xterm.js
   * internal BufferLine API, so stale styled residue past a shrunk width is
   * trimmed by `translateToString(true)`. Loud (NO SILENT ERRORS) if the
   * internal API is ever absent — a silent no-op would re-open 20335.
   */
  function clampActiveBufferWidth(t: XTerminal, cols: number, oldCols: number): void {
    // xterm.js exposes line mutation only on its internal buffer — same `_core`
    // access pattern as getExtendedAttrs below.
    const buffer = (t as any)._core?.buffer
    const lines = buffer?.lines
    if (!lines || typeof lines.get !== "function" || typeof buffer.getNullCell !== "function") {
      throw new Error(
        "xterm.js internal buffer API (buffer.lines / getNullCell) unavailable — cannot clamp " +
          "alt-screen width on shrink (20335). xterm.js internals changed; update clampActiveBufferWidth.",
      )
    }
    const nullCell = buffer.getNullCell()
    const count: number = lines.length
    for (let i = 0; i < count; i++) {
      const line = lines.get(i)
      if (!line || typeof line.replaceCells !== "function") continue
      const end: number = Math.min(oldCols, line.length)
      if (cols < end) line.replaceCells(cols, end, nullCell)
    }
  }

  function reset(): void {
    const t = ensureTerm()
    decoder = new TextDecoder()
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

  // Map xterm.js internal underlineStyle enum to our string values
  const UNDERLINE_STYLES: Record<number, Cell["underline"]> = {
    1: "single",
    2: "double",
    3: "curly",
    4: "dotted",
    5: "dashed",
  }

  /**
   * Read extended attributes from xterm.js internal line data.
   * The public IBufferCell API only exposes isUnderline (boolean),
   * but the internal _extendedAttrs stores the actual underline style and color.
   */
  function getExtendedAttrs(row: number, col: number): { underlineStyle?: number; underlineColor?: RGB | null } {
    const t = ensureTerm()
    try {
      const internalLine = (t as any)._core.buffer.lines.get(row + t.buffer.active.baseY)
      if (!internalLine?._extendedAttrs) return {}
      const ext = internalLine._extendedAttrs[col]
      if (!ext) return {}

      const style = ext.underlineStyle as number | undefined
      let color: RGB | null = null
      // Use the underlineColor getter which returns the raw 0xRRGGBB value
      const rawColor = ext.underlineColor as number | undefined
      if (rawColor && rawColor !== 0) {
        color = {
          r: (rawColor >> 16) & 0xff,
          g: (rawColor >> 8) & 0xff,
          b: rawColor & 0xff,
        }
      }
      return { underlineStyle: style, underlineColor: color ?? undefined }
    } catch {
      return {}
    }
  }

  // Note: cursor visibility (DECTCEM) and reverse video (DECSCNM) are handled
  // by the renderer in xterm.js and are not stored in headless mode.
  // These remain as genuine headless limitations.

  function convertCell(bufCell: import("@xterm/headless").IBufferCell | undefined, row?: number, col?: number): Cell {
    if (!bufCell) {
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

    // Read extended attributes for accurate underline style
    let underline: Cell["underline"] = false
    let underlineColor: RGB | null = null
    if (bufCell.isUnderline() !== 0 && row !== undefined && col !== undefined) {
      const ext = getExtendedAttrs(row, col)
      underline = (ext.underlineStyle ? UNDERLINE_STYLES[ext.underlineStyle] : "single") ?? "single"
      underlineColor = ext.underlineColor ?? null
    } else if (bufCell.isUnderline() !== 0) {
      underline = "single"
    }

    return {
      char: bufCell.getChars(),
      fg,
      bg,
      bold: bufCell.isBold() !== 0,
      dim: bufCell.isDim() !== 0,
      italic: bufCell.isItalic() !== 0,
      underline,
      underlineColor,
      strikethrough: bufCell.isStrikethrough() !== 0,
      inverse: bufCell.isInverse() !== 0,
      blink: bufCell.isBlink() !== 0,
      hidden: bufCell.isInvisible() !== 0,
      wide: bufCell.getWidth() > 1,
      continuation: false,
      hyperlink: null,
    }
  }

  function getCell(row: number, col: number): Cell {
    const t = ensureTerm()
    const line = t.buffer.active.getLine(row)
    if (!line) {
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
    return convertCell(line.getCell(col), row, col)
  }

  function getLine(row: number): Cell[] {
    const t = ensureTerm()
    const cols = t.cols
    const cells: Cell[] = []
    const line = t.buffer.active.getLine(row)
    for (let col = 0; col < cols; col++) {
      cells.push(line ? convertCell(line.getCell(col), row, col) : getCell(row, col))
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
      col: t.buffer.active.cursorX,
      row: t.buffer.active.cursorY,
      x: t.buffer.active.cursorX,
      y: t.buffer.active.cursorY,
      visible: true, // DECTCEM not available in headless mode
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
      viewportTop: buf.viewportY,
      totalRows: buf.length,
      screenRows: t.rows,
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

  const backend: TerminalBackend = {
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
