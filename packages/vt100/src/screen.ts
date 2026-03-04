/**
 * Pure TypeScript VT100 terminal emulator.
 *
 * Inspired by the Rust vt100 crate — parses a terminal byte stream and
 * maintains an in-memory screen representation with per-cell attributes,
 * cursor tracking, and mode state.
 *
 * Zero dependencies. Handles: SGR (16/256/truecolor), cursor movement,
 * erase, scroll regions, alternate screen, modes, OSC title, and more.
 */

// ═══════════════════════════════════════════════════════
// Internal cell representation
// ═══════════════════════════════════════════════════════

export interface CellColor {
  r: number
  g: number
  b: number
}

export type UnderlineStyle = "none" | "single" | "double" | "curly" | "dotted" | "dashed"

export interface ScreenCell {
  char: string
  fg: CellColor | null
  bg: CellColor | null
  bold: boolean
  faint: boolean
  italic: boolean
  underline: UnderlineStyle
  strikethrough: boolean
  inverse: boolean
  hidden: boolean
  wide: boolean
}

/** Frozen sentinel for unwritten cells — never mutate, copy-on-write in writeChar(). */
const EMPTY_CELL: ScreenCell = Object.freeze({
  char: "",
  fg: null,
  bg: null,
  bold: false,
  faint: false,
  italic: false,
  underline: "none" as UnderlineStyle,
  strikethrough: false,
  inverse: false,
  hidden: false,
  wide: false,
})

function emptyCell(): ScreenCell {
  return { ...EMPTY_CELL }
}

// ═══════════════════════════════════════════════════════
// ANSI 256-color palette
// ═══════════════════════════════════════════════════════

const ANSI_16: readonly CellColor[] = [
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

function buildPalette256(): CellColor[] {
  const palette: CellColor[] = [...ANSI_16]
  const levels = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff]
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        palette.push({ r: levels[r]!, g: levels[g]!, b: levels[b]! })
      }
    }
  }
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10
    palette.push({ r: v, g: v, b: v })
  }
  return palette
}

const PALETTE_256 = buildPalette256()

// ═══════════════════════════════════════════════════════
// Unicode width (simplified — CJK detection)
// ═══════════════════════════════════════════════════════

function isWide(codePoint: number): boolean {
  // CJK Unified Ideographs, CJK Compatibility Ideographs, etc.
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) || // Hangul Jamo
    (codePoint >= 0x2e80 && codePoint <= 0x303e) || // CJK Radicals
    (codePoint >= 0x3041 && codePoint <= 0x33bf) || // Hiragana, Katakana, Bopomofo, etc.
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) || // CJK Unified Extension A
    (codePoint >= 0x4e00 && codePoint <= 0xa4cf) || // CJK Unified Ideographs
    (codePoint >= 0xa960 && codePoint <= 0xa97c) || // Hangul Jamo Extended-A
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) || // Hangul Syllables
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK Compatibility Ideographs
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) || // Vertical Forms
    (codePoint >= 0xfe30 && codePoint <= 0xfe6b) || // CJK Compatibility Forms
    (codePoint >= 0xff01 && codePoint <= 0xff60) || // Fullwidth Forms
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) || // Fullwidth Signs
    (codePoint >= 0x1f300 && codePoint <= 0x1f9ff) || // Misc Symbols/Emoticons
    (codePoint >= 0x1fa00 && codePoint <= 0x1faff) || // Extended Symbols & Pictographs
    (codePoint >= 0x20000 && codePoint <= 0x2fffd) || // CJK Extension B-F
    (codePoint >= 0x30000 && codePoint <= 0x3fffd) // CJK Extension G+
  )
}

// ═══════════════════════════════════════════════════════
// Screen
// ═══════════════════════════════════════════════════════

export interface ScreenOptions {
  cols: number
  rows: number
  scrollbackLimit?: number
}

interface Attrs {
  fg: CellColor | null
  bg: CellColor | null
  bold: boolean
  faint: boolean
  italic: boolean
  underline: UnderlineStyle
  strikethrough: boolean
  inverse: boolean
  hidden: boolean
}

export interface Screen {
  readonly cols: number
  readonly rows: number
  process(data: Uint8Array): void
  resize(cols: number, rows: number): void
  reset(): void
  getCell(row: number, col: number): ScreenCell
  getLine(row: number): ScreenCell[]
  getText(): string
  getTextRange(startRow: number, startCol: number, endRow: number, endCol: number): string
  getCursorPosition(): { x: number; y: number }
  getCursorVisible(): boolean
  getTitle(): string
  getMode(mode: string): boolean
  getScrollbackLength(): number
  getViewportOffset(): number
  scrollViewport(delta: number): void
}

export function createScreen(opts: ScreenOptions): Screen {
  let cols = opts.cols
  let rows = opts.rows
  const scrollbackLimit = opts.scrollbackLimit ?? 1000

  // Main and alternate screen buffers
  let mainGrid: ScreenCell[][] = makeGrid(cols, rows)
  let altGrid: ScreenCell[][] = makeGrid(cols, rows)
  let grid = mainGrid
  let scrollback: ScreenCell[][] = []

  // Cursor
  let curX = 0
  let curY = 0
  let curVisible = true
  let savedCurX = 0
  let savedCurY = 0

  // DECSC/DECRC saved state (cursor + attrs + modes)
  interface SavedState {
    curX: number
    curY: number
    attrs: Attrs
    originMode: boolean
    autoWrap: boolean
  }
  let savedState: SavedState = {
    curX: 0,
    curY: 0,
    attrs: resetAttrs(),
    originMode: false,
    autoWrap: true,
  }

  // Current drawing attributes
  let attrs: Attrs = resetAttrs()

  // Terminal state
  let title = ""
  let useAltScreen = false
  let bracketedPaste = false
  let applicationCursor = false
  let applicationKeypad = false
  let autoWrap = true
  let mouseTracking = false
  let focusTracking = false
  let originMode = false
  let insertMode = false
  let reverseVideo = false

  // Scroll region (inclusive, 0-based)
  let scrollTop = 0
  let scrollBottom = rows - 1

  // Viewport scroll offset for scrollViewport()
  let viewportOffset = 0

  // Parser state
  let parserState: "ground" | "escape" | "csi" | "osc" | "dcs" | "oscString" = "ground"
  let escBuf = ""
  let oscBuf = ""

  // Decoder for incoming bytes
  const decoder = new TextDecoder()

  function makeGrid(c: number, r: number): ScreenCell[][] {
    const g: ScreenCell[][] = []
    for (let row = 0; row < r; row++) {
      g.push(makeRow(c))
    }
    return g
  }

  function makeRow(c: number): ScreenCell[] {
    const row: ScreenCell[] = []
    for (let col = 0; col < c; col++) {
      row.push(EMPTY_CELL)
    }
    return row
  }

  function resetAttrs(): Attrs {
    return {
      fg: null,
      bg: null,
      bold: false,
      faint: false,
      italic: false,
      underline: "none",
      strikethrough: false,
      inverse: false,
      hidden: false,
    }
  }

  function clampCursor(): void {
    if (curX < 0) curX = 0
    if (curX >= cols) curX = cols - 1
    if (curY < 0) curY = 0
    if (curY >= rows) curY = rows - 1
  }

  // ── Scrolling ──

  function scrollUp(top: number, bottom: number): void {
    // Move top row to scrollback (only if main screen & top of screen)
    if (grid === mainGrid && top === 0) {
      scrollback.push(grid[0]!)
      // Bulk trim when exceeding 2x limit to avoid O(n) shift() on every scroll
      if (scrollback.length > scrollbackLimit * 2) {
        scrollback.splice(0, scrollback.length - scrollbackLimit)
      }
    }
    // Shift rows up within the region
    for (let i = top; i < bottom; i++) {
      grid[i] = grid[i + 1]!
    }
    grid[bottom] = makeRow(cols)
  }

  function scrollDown(top: number, bottom: number): void {
    for (let i = bottom; i > top; i--) {
      grid[i] = grid[i - 1]!
    }
    grid[top] = makeRow(cols)
  }

  // ── Character writing ──

  function writeChar(ch: string): void {
    const codePoint = ch.codePointAt(0) ?? 0
    const wide = isWide(codePoint)
    const charWidth = wide ? 2 : 1

    // Handle autowrap at end of line
    if (curX + charWidth > cols) {
      if (autoWrap) {
        curX = 0
        curY++
        if (curY > scrollBottom) {
          curY = scrollBottom
          scrollUp(scrollTop, scrollBottom)
        }
      } else {
        curX = cols - charWidth
      }
    }

    // Insert mode: shift existing characters right before writing
    if (insertMode) {
      const row = grid[curY]!
      for (let i = 0; i < charWidth; i++) {
        row.splice(curX, 0, EMPTY_CELL)
        row.pop()
      }
    }

    // Copy-on-write: if cell is the shared EMPTY_CELL sentinel, create a fresh object
    const row = grid[curY]!
    let cell = row[curX]!
    if (cell === EMPTY_CELL) {
      cell = { ...EMPTY_CELL }
      row[curX] = cell
    }
    cell.char = ch
    cell.fg = attrs.fg ? { ...attrs.fg } : null
    cell.bg = attrs.bg ? { ...attrs.bg } : null
    cell.bold = attrs.bold
    cell.faint = attrs.faint
    cell.italic = attrs.italic
    cell.underline = attrs.underline
    cell.strikethrough = attrs.strikethrough
    cell.inverse = attrs.inverse
    cell.hidden = attrs.hidden
    cell.wide = wide

    if (wide && curX + 1 < cols) {
      // Spacer cell for wide character — always create fresh
      let spacer = row[curX + 1]!
      if (spacer === EMPTY_CELL) {
        spacer = { ...EMPTY_CELL }
        row[curX + 1] = spacer
      }
      spacer.char = ""
      spacer.fg = null
      spacer.bg = null
      spacer.bold = false
      spacer.faint = false
      spacer.italic = false
      spacer.underline = "none"
      spacer.strikethrough = false
      spacer.inverse = false
      spacer.hidden = false
      spacer.wide = false
    }

    curX += charWidth
  }

  // ── CSI handler ──

  function handleCSI(params: string, finalByte: string): void {
    const parts = params.split(";").map((s) => (s === "" ? 0 : parseInt(s, 10)))

    switch (finalByte) {
      case "A": // CUU - Cursor Up
        curY -= Math.max(parts[0] ?? 1, 1)
        clampCursor()
        break
      case "B": // CUD - Cursor Down
        curY += Math.max(parts[0] ?? 1, 1)
        clampCursor()
        break
      case "C": // CUF - Cursor Forward
        curX += Math.max(parts[0] ?? 1, 1)
        clampCursor()
        break
      case "D": // CUB - Cursor Back
        curX -= Math.max(parts[0] ?? 1, 1)
        clampCursor()
        break
      case "E": // CNL - Cursor Next Line
        curY += Math.max(parts[0] ?? 1, 1)
        curX = 0
        clampCursor()
        break
      case "F": // CPL - Cursor Previous Line
        curY -= Math.max(parts[0] ?? 1, 1)
        curX = 0
        clampCursor()
        break
      case "G": // CHA - Cursor Horizontal Absolute
        curX = (parts[0] ?? 1) - 1
        clampCursor()
        break
      case "H": // CUP - Cursor Position
      case "f": // HVP - same as CUP
        curY = (parts[0] ?? 1) - 1
        curX = (parts[1] ?? 1) - 1
        clampCursor()
        break
      case "J": // ED - Erase in Display
        handleEraseDisplay(parts[0] ?? 0)
        break
      case "K": // EL - Erase in Line
        handleEraseLine(parts[0] ?? 0)
        break
      case "L": // IL - Insert Lines
        handleInsertLines(Math.max(parts[0] ?? 1, 1))
        break
      case "M": // DL - Delete Lines
        handleDeleteLines(Math.max(parts[0] ?? 1, 1))
        break
      case "P": // DCH - Delete Characters
        handleDeleteChars(Math.max(parts[0] ?? 1, 1))
        break
      case "@": // ICH - Insert Characters
        handleInsertChars(Math.max(parts[0] ?? 1, 1))
        break
      case "X": // ECH - Erase Characters
        handleEraseChars(Math.max(parts[0] ?? 1, 1))
        break
      case "S": // SU - Scroll Up
        for (let i = 0; i < Math.max(parts[0] ?? 1, 1); i++) {
          scrollUp(scrollTop, scrollBottom)
        }
        break
      case "T": // SD - Scroll Down
        for (let i = 0; i < Math.max(parts[0] ?? 1, 1); i++) {
          scrollDown(scrollTop, scrollBottom)
        }
        break
      case "d": // VPA - Line Position Absolute
        curY = (parts[0] ?? 1) - 1
        clampCursor()
        break
      case "m": // SGR - Select Graphic Rendition
        handleSGR(params)
        break
      case "r": // DECSTBM - Set Scrolling Region
        scrollTop = (parts[0] ?? 1) - 1
        scrollBottom = (parts[1] ?? rows) - 1
        if (scrollTop < 0) scrollTop = 0
        if (scrollBottom >= rows) scrollBottom = rows - 1
        if (scrollTop > scrollBottom) {
          scrollTop = 0
          scrollBottom = rows - 1
        }
        curX = 0
        curY = originMode ? scrollTop : 0
        break
      case "n": // DSR - Device Status Report (ignore)
        break
      case "c": // DA - Device Attributes (ignore)
        break
      case "s": // SCP - Save Cursor Position
        savedCurX = curX
        savedCurY = curY
        break
      case "u": // RCP - Restore Cursor Position
        curX = savedCurX
        curY = savedCurY
        clampCursor()
        break
      default:
        // Unknown CSI sequence — ignore
        break
    }
  }

  function handleCSIPrivate(params: string, finalByte: string): void {
    const parts = params.split(";").map((s) => (s === "" ? 0 : parseInt(s, 10)))
    const set = finalByte === "h"

    for (const code of parts) {
      switch (code) {
        case 1: // DECCKM - Application Cursor
          applicationCursor = set
          break
        case 6: // DECOM - Origin Mode
          originMode = set
          break
        case 7: // DECAWM - Autowrap Mode
          autoWrap = set
          break
        case 25: // DECTCEM - Cursor Visible
          curVisible = set
          break
        case 47: // Alternate screen buffer (old)
        case 1047: // Alternate screen buffer
          if (set && !useAltScreen) {
            useAltScreen = true
            grid = altGrid
          } else if (!set && useAltScreen) {
            useAltScreen = false
            grid = mainGrid
          }
          break
        case 66: // DECNKM - Application Keypad
          applicationKeypad = set
          break
        case 1000: // Mouse tracking (basic)
        case 1002: // Mouse tracking (button events)
        case 1003: // Mouse tracking (all events)
          mouseTracking = set
          break
        case 1004: // Focus tracking
          focusTracking = set
          break
        case 1049: // Alternate screen buffer + save/restore cursor
          if (set && !useAltScreen) {
            savedCurX = curX
            savedCurY = curY
            useAltScreen = true
            altGrid = makeGrid(cols, rows)
            grid = altGrid
            curX = 0
            curY = 0
          } else if (!set && useAltScreen) {
            useAltScreen = false
            grid = mainGrid
            curX = savedCurX
            curY = savedCurY
            clampCursor()
          }
          break
        case 2004: // Bracketed paste
          bracketedPaste = set
          break
        case 5: // DECSCNM - Reverse Video
          reverseVideo = set
          break
        case 4: // IRM - Insert Mode (via DEC private)
          insertMode = set
          break
      }
    }
  }

  function handleEraseDisplay(mode: number): void {
    switch (mode) {
      case 0: // Erase from cursor to end
        eraseCells(curY, curX, curY, cols - 1)
        for (let row = curY + 1; row < rows; row++) {
          eraseCells(row, 0, row, cols - 1)
        }
        break
      case 1: // Erase from start to cursor
        for (let row = 0; row < curY; row++) {
          eraseCells(row, 0, row, cols - 1)
        }
        eraseCells(curY, 0, curY, curX)
        break
      case 2: // Erase entire display
      case 3: // Erase entire display + scrollback
        for (let row = 0; row < rows; row++) {
          eraseCells(row, 0, row, cols - 1)
        }
        if (mode === 3) {
          scrollback.length = 0
        }
        break
    }
  }

  function handleEraseLine(mode: number): void {
    switch (mode) {
      case 0: // Erase from cursor to end of line
        eraseCells(curY, curX, curY, cols - 1)
        break
      case 1: // Erase from start to cursor
        eraseCells(curY, 0, curY, curX)
        break
      case 2: // Erase entire line
        eraseCells(curY, 0, curY, cols - 1)
        break
    }
  }

  function eraseCells(row: number, startCol: number, _endRow: number, endCol: number): void {
    const r = grid[row]
    if (!r) return
    for (let col = startCol; col <= endCol && col < cols; col++) {
      r[col] = emptyCell()
    }
  }

  function handleInsertLines(count: number): void {
    if (curY < scrollTop || curY > scrollBottom) return
    for (let i = 0; i < count; i++) {
      scrollDown(curY, scrollBottom)
    }
  }

  function handleDeleteLines(count: number): void {
    if (curY < scrollTop || curY > scrollBottom) return
    for (let i = 0; i < count; i++) {
      scrollUp(curY, scrollBottom)
    }
  }

  function handleDeleteChars(count: number): void {
    const row = grid[curY]
    if (!row) return
    for (let i = 0; i < count; i++) {
      if (curX < cols) {
        row.splice(curX, 1)
        row.push(emptyCell())
      }
    }
  }

  function handleInsertChars(count: number): void {
    const row = grid[curY]
    if (!row) return
    for (let i = 0; i < count; i++) {
      row.splice(curX, 0, emptyCell())
      row.pop()
    }
  }

  function handleEraseChars(count: number): void {
    const row = grid[curY]
    if (!row) return
    for (let i = 0; i < count && curX + i < cols; i++) {
      row[curX + i] = emptyCell()
    }
  }

  // ── SGR (Select Graphic Rendition) ──

  function handleSGR(rawParams: string): void {
    // Parse SGR parameters, handling colon sub-parameters (e.g., "4:3" for curly underline)
    const segments = rawParams.split(";")
    const params: number[] = []
    // Map from param index to colon sub-parameters (e.g., index of "4" -> [4, 3])
    const subParams = new Map<number, number[]>()
    for (const seg of segments) {
      if (seg.includes(":")) {
        const subs = seg.split(":").map((s) => (s === "" ? 0 : parseInt(s, 10)))
        subParams.set(params.length, subs)
        params.push(subs[0]!)
      } else {
        params.push(seg === "" ? 0 : parseInt(seg, 10))
      }
    }

    if (params.length === 0 || (params.length === 1 && params[0] === 0)) {
      attrs = resetAttrs()
      return
    }

    let i = 0
    while (i < params.length) {
      const code = params[i]!
      switch (code) {
        case 0:
          attrs = resetAttrs()
          break
        case 1:
          attrs.bold = true
          break
        case 2:
          attrs.faint = true
          break
        case 3:
          attrs.italic = true
          break
        case 4: {
          // SGR 4 with optional sub-parameter: 4:0=none, 4:1=single, 4:3=curly, etc.
          const subs = subParams.get(i)
          if (subs && subs.length > 1) {
            const sub = subs[1]!
            switch (sub) {
              case 0:
                attrs.underline = "none"
                break
              case 1:
                attrs.underline = "single"
                break
              case 2:
                attrs.underline = "double"
                break
              case 3:
                attrs.underline = "curly"
                break
              case 4:
                attrs.underline = "dotted"
                break
              case 5:
                attrs.underline = "dashed"
                break
              default:
                attrs.underline = "single"
                break
            }
          } else {
            attrs.underline = "single"
          }
          break
        }
        case 7:
          attrs.inverse = true
          break
        case 8: // Hidden/conceal
          attrs.hidden = true
          break
        case 9:
          attrs.strikethrough = true
          break
        case 21: // Double underline
          attrs.underline = "double"
          break
        case 22: // Normal intensity (neither bold nor faint)
          attrs.bold = false
          attrs.faint = false
          break
        case 23:
          attrs.italic = false
          break
        case 24:
          attrs.underline = "none"
          break
        case 27:
          attrs.inverse = false
          break
        case 28: // Reveal (turn off hidden/conceal)
          attrs.hidden = false
          break
        case 29:
          attrs.strikethrough = false
          break
        // Foreground colors 30-37
        case 30:
        case 31:
        case 32:
        case 33:
        case 34:
        case 35:
        case 36:
        case 37:
          attrs.fg = { ...PALETTE_256[code - 30]! }
          break
        case 38: {
          // Extended foreground: 38;5;N (256) or 38;2;R;G;B (truecolor)
          const result = parseExtendedColor(params, i)
          if (result) {
            attrs.fg = result.color
            i = result.nextIndex - 1 // -1 because loop increments
          }
          break
        }
        case 39: // Default foreground
          attrs.fg = null
          break
        // Background colors 40-47
        case 40:
        case 41:
        case 42:
        case 43:
        case 44:
        case 45:
        case 46:
        case 47:
          attrs.bg = { ...PALETTE_256[code - 40]! }
          break
        case 48: {
          // Extended background: 48;5;N (256) or 48;2;R;G;B (truecolor)
          const result = parseExtendedColor(params, i)
          if (result) {
            attrs.bg = result.color
            i = result.nextIndex - 1
          }
          break
        }
        case 49: // Default background
          attrs.bg = null
          break
        // Bright foreground 90-97
        case 90:
        case 91:
        case 92:
        case 93:
        case 94:
        case 95:
        case 96:
        case 97:
          attrs.fg = { ...PALETTE_256[code - 90 + 8]! }
          break
        // Bright background 100-107
        case 100:
        case 101:
        case 102:
        case 103:
        case 104:
        case 105:
        case 106:
        case 107:
          attrs.bg = { ...PALETTE_256[code - 100 + 8]! }
          break
      }
      i++
    }
  }

  function parseExtendedColor(params: number[], startIndex: number): { color: CellColor; nextIndex: number } | null {
    if (startIndex + 1 >= params.length) return null

    const type = params[startIndex + 1]
    if (type === 5 && startIndex + 2 < params.length) {
      // 256-color: 38;5;N
      const idx = params[startIndex + 2]!
      const color = PALETTE_256[idx] ?? { r: 0, g: 0, b: 0 }
      return { color: { ...color }, nextIndex: startIndex + 3 }
    } else if (type === 2 && startIndex + 4 < params.length) {
      // Truecolor: 38;2;R;G;B
      return {
        color: {
          r: params[startIndex + 2]!,
          g: params[startIndex + 3]!,
          b: params[startIndex + 4]!,
        },
        nextIndex: startIndex + 5,
      }
    }
    return null
  }

  // ── OSC handler ──

  function handleOSC(oscString: string): void {
    const semicolonIdx = oscString.indexOf(";")
    if (semicolonIdx === -1) return

    const code = parseInt(oscString.substring(0, semicolonIdx), 10)
    const value = oscString.substring(semicolonIdx + 1)

    switch (code) {
      case 0: // Set icon name and window title
      case 2: // Set window title
        title = value
        break
      case 1: // Set icon name (ignore)
        break
    }
  }

  // ── Main parser ──

  function process(data: Uint8Array): void {
    const text = decoder.decode(data, { stream: true })

    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!
      const code = text.charCodeAt(i)

      switch (parserState) {
        case "ground":
          if (code === 0x1b) {
            parserState = "escape"
            escBuf = ""
          } else if (code === 0x07) {
            // BEL — ignore
          } else if (code === 0x08) {
            // BS - Backspace
            if (curX > 0) curX--
          } else if (code === 0x09) {
            // TAB
            curX = Math.min((Math.floor(curX / 8) + 1) * 8, cols - 1)
          } else if (code === 0x0a || code === 0x0b || code === 0x0c) {
            // LF, VT, FF — linefeed
            curY++
            if (curY > scrollBottom) {
              curY = scrollBottom
              scrollUp(scrollTop, scrollBottom)
            }
          } else if (code === 0x0d) {
            // CR - Carriage Return
            curX = 0
          } else if (code >= 0x20) {
            // Handle surrogate pairs for characters > U+FFFF
            let char = ch
            if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
              const nextCode = text.charCodeAt(i + 1)
              if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
                char = ch + text[i + 1]!
                i++
              }
            }
            writeChar(char)
          }
          break

        case "escape":
          if (ch === "[") {
            parserState = "csi"
            escBuf = ""
          } else if (ch === "]") {
            parserState = "osc"
            oscBuf = ""
          } else if (ch === "P") {
            parserState = "dcs"
            escBuf = ""
          } else if (ch === "c") {
            // RIS - Reset to Initial State
            fullReset()
          } else if (ch === "D") {
            // IND - Index (move cursor down, scroll if needed)
            curY++
            if (curY > scrollBottom) {
              curY = scrollBottom
              scrollUp(scrollTop, scrollBottom)
            }
            parserState = "ground"
          } else if (ch === "M") {
            // RI - Reverse Index (move cursor up, scroll if needed)
            curY--
            if (curY < scrollTop) {
              curY = scrollTop
              scrollDown(scrollTop, scrollBottom)
            }
            parserState = "ground"
          } else if (ch === "7") {
            // DECSC - Save Cursor + attributes + modes
            savedState = {
              curX,
              curY,
              attrs: { ...attrs, fg: attrs.fg ? { ...attrs.fg } : null, bg: attrs.bg ? { ...attrs.bg } : null },
              originMode,
              autoWrap,
            }
            parserState = "ground"
          } else if (ch === "8") {
            // DECRC - Restore Cursor + attributes + modes
            curX = savedState.curX
            curY = savedState.curY
            attrs = {
              ...savedState.attrs,
              fg: savedState.attrs.fg ? { ...savedState.attrs.fg } : null,
              bg: savedState.attrs.bg ? { ...savedState.attrs.bg } : null,
            }
            originMode = savedState.originMode
            autoWrap = savedState.autoWrap
            clampCursor()
            parserState = "ground"
          } else if (ch === "E") {
            // NEL - Next Line
            curX = 0
            curY++
            if (curY > scrollBottom) {
              curY = scrollBottom
              scrollUp(scrollTop, scrollBottom)
            }
            parserState = "ground"
          } else {
            // Unknown escape — return to ground
            parserState = "ground"
          }
          break

        case "csi":
          if (code >= 0x40 && code <= 0x7e) {
            // Final byte — dispatch CSI
            if (escBuf.startsWith("?")) {
              handleCSIPrivate(escBuf.substring(1), ch)
            } else {
              handleCSI(escBuf, ch)
            }
            parserState = "ground"
          } else if (escBuf.length >= 256) {
            // Buffer overflow — drop to ground to avoid unbounded accumulation
            parserState = "ground"
          } else {
            // Parameter or intermediate byte
            escBuf += ch
          }
          break

        case "osc":
          if (code === 0x07) {
            // BEL terminates OSC
            handleOSC(oscBuf)
            parserState = "ground"
          } else if (code === 0x1b) {
            // ESC might be start of ST (\x1b\\)
            parserState = "oscString"
          } else if (oscBuf.length >= 4096) {
            // Buffer overflow — drop to ground to avoid unbounded accumulation
            parserState = "ground"
          } else {
            oscBuf += ch
          }
          break

        case "oscString":
          if (ch === "\\") {
            // ST (String Terminator) — end of OSC
            handleOSC(oscBuf)
          }
          // Either way, back to ground
          parserState = "ground"
          break

        case "dcs":
          // Consume until ST
          if (code === 0x1b) {
            parserState = "oscString" // Reuse ST detection
          }
          break
      }
    }
  }

  function fullReset(): void {
    mainGrid = makeGrid(cols, rows)
    altGrid = makeGrid(cols, rows)
    grid = mainGrid
    scrollback = []
    curX = 0
    curY = 0
    curVisible = true
    savedCurX = 0
    savedCurY = 0
    savedState = { curX: 0, curY: 0, attrs: resetAttrs(), originMode: false, autoWrap: true }
    attrs = resetAttrs()
    title = ""
    useAltScreen = false
    bracketedPaste = false
    applicationCursor = false
    applicationKeypad = false
    autoWrap = true
    mouseTracking = false
    focusTracking = false
    originMode = false
    insertMode = false
    reverseVideo = false
    scrollTop = 0
    scrollBottom = rows - 1
    viewportOffset = 0
    parserState = "ground"
    escBuf = ""
    oscBuf = ""
  }

  function resize(newCols: number, newRows: number): void {
    const newMain = makeGrid(newCols, newRows)
    const newAlt = makeGrid(newCols, newRows)

    // Copy content from old grids
    copyGrid(mainGrid, newMain, Math.min(cols, newCols), Math.min(rows, newRows))
    copyGrid(altGrid, newAlt, Math.min(cols, newCols), Math.min(rows, newRows))

    mainGrid = newMain
    altGrid = newAlt
    grid = useAltScreen ? altGrid : mainGrid
    cols = newCols
    rows = newRows
    scrollTop = 0
    scrollBottom = rows - 1
    clampCursor()
  }

  function copyGrid(src: ScreenCell[][], dst: ScreenCell[][], copyCols: number, copyRows: number): void {
    for (let row = 0; row < copyRows; row++) {
      for (let col = 0; col < copyCols; col++) {
        const srcCell = src[row]?.[col]
        if (srcCell) {
          dst[row]![col] = { ...srcCell }
        }
      }
    }
  }

  function getCell(row: number, col: number): ScreenCell {
    const r = grid[row]
    if (!r || col >= cols) return emptyCell()
    return { ...r[col]! }
  }

  function getLine(row: number): ScreenCell[] {
    const r = grid[row]
    if (!r) return makeRow(cols)
    return r.map((cell) => ({ ...cell }))
  }

  function getText(): string {
    const lines: string[] = []

    // Scrollback
    for (const row of scrollback) {
      lines.push(rowToString(row))
    }

    // Screen
    for (let r = 0; r < rows; r++) {
      lines.push(rowToString(grid[r]!))
    }

    return lines.join("\n")
  }

  function rowToString(row: ScreenCell[]): string {
    let line = ""
    for (let i = 0; i < row.length; i++) {
      const cell = row[i]!
      if (cell.wide) {
        line += cell.char
      } else if (cell.char === "") {
        // Skip spacer cells after wide chars, otherwise treat as space
        if (i > 0 && row[i - 1]?.wide) {
          continue
        }
        line += " "
      } else {
        line += cell.char
      }
    }
    return line.replace(/\s+$/, "") // Trim trailing whitespace
  }

  function getTextRange(startRow: number, startCol: number, endRow: number, endCol: number): string {
    const parts: string[] = []

    for (let row = startRow; row <= endRow; row++) {
      const r = grid[row]
      if (!r) continue

      const colStart = row === startRow ? startCol : 0
      const colEnd = row === endRow ? endCol : cols

      let line = ""
      for (let col = colStart; col < colEnd; col++) {
        const cell = r[col]
        if (!cell) continue
        if (cell.char === "" && col > 0 && r[col - 1]?.wide) continue // Skip spacer
        line += cell.char || " "
      }
      parts.push(line.replace(/\s+$/, ""))
    }

    return parts.join("\n")
  }

  function getMode(mode: string): boolean {
    switch (mode) {
      case "altScreen":
        return useAltScreen
      case "cursorVisible":
        return curVisible
      case "bracketedPaste":
        return bracketedPaste
      case "applicationCursor":
        return applicationCursor
      case "applicationKeypad":
        return applicationKeypad
      case "autoWrap":
        return autoWrap
      case "mouseTracking":
        return mouseTracking
      case "focusTracking":
        return focusTracking
      case "originMode":
        return originMode
      case "insertMode":
        return insertMode
      case "reverseVideo":
        return reverseVideo
      default:
        return false
    }
  }

  return {
    get cols() {
      return cols
    },
    get rows() {
      return rows
    },
    process,
    resize,
    reset: fullReset,
    getCell,
    getLine,
    getText,
    getTextRange,
    getCursorPosition: () => ({ x: curX, y: curY }),
    getCursorVisible: () => curVisible,
    getTitle: () => title,
    getMode,
    getScrollbackLength: () => scrollback.length,
    getViewportOffset: () => viewportOffset,
    scrollViewport: (delta: number) => {
      viewportOffset = Math.max(0, Math.min(scrollback.length, viewportOffset + delta))
    },
  }
}
