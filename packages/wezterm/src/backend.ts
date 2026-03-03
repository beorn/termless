/**
 * WezTerm backend for termless.
 *
 * Wraps the wezterm-term Rust crate (tattoy fork) via napi-rs native bindings
 * to implement the TerminalBackend interface — same VT parser that powers the
 * WezTerm terminal emulator, but headless via native Node addon.
 *
 * Requires the native module to be built first:
 *   cd packages/wezterm/native && cargo build --release
 *   cp target/release/libtermless_wezterm_native.dylib ../termless-wezterm.node
 *
 * TODO: Set up @napi-rs/cli build pipeline for cross-platform prebuilds.
 */

import type {
  TerminalBackend,
  TerminalOptions,
  Cell,
  CursorState,
  KeyDescriptor,
  TerminalMode,
  ScrollbackState,
  TerminalCapabilities,
  RGB,
} from "../../../src/types.ts"

// ═══════════════════════════════════════════════════════
// Native module loading
// ═══════════════════════════════════════════════════════

interface NapiCell {
  text: string
  fgR: number
  fgG: number
  fgB: number
  fgIsDefault: boolean
  bgR: number
  bgG: number
  bgB: number
  bgIsDefault: boolean
  bold: boolean
  faint: boolean
  italic: boolean
  underline: string
  strikethrough: boolean
  inverse: boolean
  wide: boolean
}

interface NapiCursor {
  x: number
  y: number
  visible: boolean
  style: string
}

interface NapiScrollback {
  viewportOffset: number
  totalLines: number
  screenLines: number
}

interface WeztermTerminal {
  feed(data: Buffer): void
  resize(cols: number, rows: number): void
  reset(): void
  getText(): string
  getTextRange(startRow: number, startCol: number, endRow: number, endCol: number): string
  getCell(row: number, col: number): NapiCell
  getLine(row: number): NapiCell[]
  getCursor(): NapiCursor
  getMode(mode: string): boolean
  getTitle(): string
  getScrollback(): NapiScrollback
  scrollViewport(delta: number): void
}

interface NativeModule {
  WeztermTerminal: new (cols: number, rows: number, scrollbackLimit?: number) => WeztermTerminal
}

let nativeModule: NativeModule | null = null
let loadError: Error | null = null

/**
 * Load the native wezterm module. Call once before creating backends.
 * Returns the native module, or throws if the .node file is missing.
 */
export function loadWeztermNative(): NativeModule {
  if (nativeModule) return nativeModule
  if (loadError) throw loadError

  try {
    // Try loading the prebuilt native addon
    // The .node file should be at packages/wezterm/termless-wezterm.node
    const mod = require("../termless-wezterm.node") as NativeModule
    nativeModule = mod
    return mod
  } catch (e) {
    loadError = new Error(
      "Failed to load wezterm native module. Build it first:\n" +
        "  cd packages/wezterm/native && cargo build --release\n" +
        "  cp target/release/libtermless_wezterm_native.dylib ../termless-wezterm.node\n" +
        `\nOriginal error: ${e instanceof Error ? e.message : String(e)}`,
    )
    throw loadError
  }
}

// ═══════════════════════════════════════════════════════
// ANSI 256-color palette (shared with other backends)
// ═══════════════════════════════════════════════════════

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

function paletteToRgb(index: number): RGB {
  return PALETTE_256[index] ?? { r: 0, g: 0, b: 0 }
}

// ═══════════════════════════════════════════════════════
// Key encoding (standard ANSI — shared across backends)
// ═══════════════════════════════════════════════════════

const SPECIAL_KEYS: Record<string, string> = {
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowRight: "\x1b[C",
  ArrowLeft: "\x1b[D",
  Home: "\x1b[H",
  End: "\x1b[F",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~",
  Insert: "\x1b[2~",
  Delete: "\x1b[3~",
  Enter: "\r",
  Tab: "\t",
  Backspace: "\x7f",
  Escape: "\x1b",
  Space: " ",
  F1: "\x1bOP",
  F2: "\x1bOQ",
  F3: "\x1bOR",
  F4: "\x1bOS",
  F5: "\x1b[15~",
  F6: "\x1b[17~",
  F7: "\x1b[18~",
  F8: "\x1b[19~",
  F9: "\x1b[20~",
  F10: "\x1b[21~",
  F11: "\x1b[23~",
  F12: "\x1b[24~",
}

const CSI_KEYS: Record<string, { code: string; suffix: string }> = {
  ArrowUp: { code: "1", suffix: "A" },
  ArrowDown: { code: "1", suffix: "B" },
  ArrowRight: { code: "1", suffix: "C" },
  ArrowLeft: { code: "1", suffix: "D" },
  Home: { code: "1", suffix: "H" },
  End: { code: "1", suffix: "F" },
  PageUp: { code: "5", suffix: "~" },
  PageDown: { code: "6", suffix: "~" },
  Insert: { code: "2", suffix: "~" },
  Delete: { code: "3", suffix: "~" },
  F1: { code: "1", suffix: "P" },
  F2: { code: "1", suffix: "Q" },
  F3: { code: "1", suffix: "R" },
  F4: { code: "1", suffix: "S" },
  F5: { code: "15", suffix: "~" },
  F6: { code: "17", suffix: "~" },
  F7: { code: "18", suffix: "~" },
  F8: { code: "19", suffix: "~" },
  F9: { code: "20", suffix: "~" },
  F10: { code: "21", suffix: "~" },
  F11: { code: "23", suffix: "~" },
  F12: { code: "24", suffix: "~" },
}

function modifierParam(key: KeyDescriptor): number {
  let bits = 0
  if (key.shift) bits |= 1
  if (key.alt) bits |= 2
  if (key.ctrl) bits |= 4
  return bits + 1
}

function encodeKeyToAnsi(key: KeyDescriptor): Uint8Array {
  const hasModifier = key.shift || key.alt || key.ctrl

  if (key.ctrl && !key.alt && !key.shift && key.key.length === 1) {
    const code = key.key.toLowerCase().charCodeAt(0) - 96
    if (code >= 1 && code <= 26) {
      return new Uint8Array([code])
    }
  }

  if (key.alt && !key.ctrl && !key.shift && key.key.length === 1) {
    return new TextEncoder().encode(`\x1b${key.key}`)
  }

  if (hasModifier && key.key in CSI_KEYS) {
    const csi = CSI_KEYS[key.key]!
    const mod = modifierParam(key)
    return new TextEncoder().encode(`\x1b[${csi.code};${mod}${csi.suffix}`)
  }

  if (key.key in SPECIAL_KEYS) {
    return new TextEncoder().encode(SPECIAL_KEYS[key.key]!)
  }

  return new TextEncoder().encode(key.key)
}

// ═══════════════════════════════════════════════════════
// Cell conversion
// ═══════════════════════════════════════════════════════

function convertNapiCell(cell: NapiCell): Cell {
  const fg: RGB | null = cell.fgIsDefault ? null : { r: cell.fgR, g: cell.fgG, b: cell.fgB }
  const bg: RGB | null = cell.bgIsDefault ? null : { r: cell.bgR, g: cell.bgG, b: cell.bgB }

  return {
    text: cell.text,
    fg,
    bg,
    bold: cell.bold,
    faint: cell.faint,
    italic: cell.italic,
    underline: cell.underline as Cell["underline"],
    strikethrough: cell.strikethrough,
    inverse: cell.inverse,
    wide: cell.wide,
  }
}

const EMPTY_CELL: Cell = {
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

// ═══════════════════════════════════════════════════════
// Backend factory
// ═══════════════════════════════════════════════════════

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

/**
 * Create a WezTerm backend for termless.
 *
 * Uses the wezterm-term Rust crate (tattoy fork) via napi-rs for headless
 * terminal emulation. The native module must be built and available before
 * calling this function.
 *
 * @param opts - Optional terminal dimensions for eager initialization
 * @param native - Optional pre-loaded native module (for test isolation)
 */
export function createWeztermBackend(
  opts?: Partial<TerminalOptions>,
  native?: NativeModule,
): TerminalBackend {
  let term: WeztermTerminal | null = null
  let nativeMod: NativeModule | null = native ?? null
  let cols = DEFAULT_COLS
  let rows = DEFAULT_ROWS

  function ensureNative(): NativeModule {
    if (!nativeMod) {
      nativeMod = loadWeztermNative()
    }
    return nativeMod
  }

  function ensureTerm(): WeztermTerminal {
    if (!term) throw new Error("wezterm backend not initialized — call init() first")
    return term
  }

  function init(options: TerminalOptions): void {
    const mod = ensureNative()

    cols = options.cols
    rows = options.rows

    term = new mod.WeztermTerminal(cols, rows, options.scrollbackLimit ?? 1000)
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
    term = null
  }

  function feed(data: Uint8Array): void {
    const t = ensureTerm()
    t.feed(Buffer.from(data))
  }

  function resize(newCols: number, newRows: number): void {
    const t = ensureTerm()
    t.resize(newCols, newRows)
    cols = newCols
    rows = newRows
  }

  function reset(): void {
    ensureTerm().reset()
  }

  function getText(): string {
    return ensureTerm().getText()
  }

  function getTextRange(startRow: number, startCol: number, endRow: number, endCol: number): string {
    return ensureTerm().getTextRange(startRow, startCol, endRow, endCol)
  }

  function getCell(row: number, col: number): Cell {
    const t = ensureTerm()
    const napiCell = t.getCell(row, col)
    return convertNapiCell(napiCell)
  }

  function getLine(row: number): Cell[] {
    const t = ensureTerm()
    const napiCells = t.getLine(row)
    return napiCells.map(convertNapiCell)
  }

  function getLines(): Cell[][] {
    const result: Cell[][] = []
    for (let row = 0; row < rows; row++) {
      result.push(getLine(row))
    }
    return result
  }

  function getCursor(): CursorState {
    const t = ensureTerm()
    const cursor = t.getCursor()
    return {
      x: cursor.x,
      y: cursor.y,
      visible: cursor.visible,
      style: (cursor.style as CursorState["style"]) ?? "block",
    }
  }

  function getMode(mode: TerminalMode): boolean {
    return ensureTerm().getMode(mode)
  }

  function getTitle(): string {
    return ensureTerm().getTitle()
  }

  function getScrollback(): ScrollbackState {
    const t = ensureTerm()
    const sb = t.getScrollback()
    return {
      viewportOffset: sb.viewportOffset,
      totalLines: sb.totalLines,
      screenLines: sb.screenLines,
    }
  }

  function scrollViewport(delta: number): void {
    ensureTerm().scrollViewport(delta)
  }

  const capabilities: TerminalCapabilities = {
    name: "wezterm",
    version: "0.1.0",
    truecolor: true,
    kittyKeyboard: true,
    kittyGraphics: false, // Not available in headless mode
    sixel: true,
    osc8Hyperlinks: true,
    semanticPrompts: true,
    unicode: "15.1",
    reflow: true,
    extensions: new Set(),
  }

  return {
    name: "wezterm",
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
