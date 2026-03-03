/**
 * Alacritty backend for termless.
 *
 * Wraps alacritty_terminal (Rust) via napi-rs to implement the TerminalBackend
 * interface — same terminal emulation logic that runs in Alacritty, but headless.
 *
 * TODO: Build native module with `cd native && cargo build --release`
 * TODO: After building, the .node binary will be at native/target/release/
 * TODO: Wire up napi-rs build artifacts to the import below
 */

import type {
  TerminalBackend,
  TerminalOptions,
  Cell,
  CursorState,
  CursorStyle,
  KeyDescriptor,
  TerminalMode,
  ScrollbackState,
  TerminalCapabilities,
  RGB,
} from "../../../src/types.ts"

// ═══════════════════════════════════════════════════════
// Native module types (from napi-rs)
// ═══════════════════════════════════════════════════════

/**
 * TODO: These types mirror the napi exports from native/src/lib.rs.
 * Once the native module is built, replace this with:
 *   import { AlacrittyTerminal } from "../native/index.js"
 */
interface NativeCell {
  text: string
  fg: number[] | null // [r, g, b] or null
  bg: number[] | null
  bold: boolean
  faint: boolean
  italic: boolean
  underline: string // "none" | "single" | "double" | "curly" | "dotted" | "dashed"
  strikethrough: boolean
  inverse: boolean
  wide: boolean
}

interface NativeCursor {
  x: number
  y: number
  visible: boolean
  style: string // "block" | "underline" | "beam"
}

interface NativeAlacrittyTerminal {
  feed(data: Buffer): void
  resize(cols: number, rows: number): void
  getText(): string
  getTextRange(startRow: number, startCol: number, endRow: number, endCol: number): string
  getCell(row: number, col: number): NativeCell
  getLine(row: number): NativeCell[]
  getLines(): NativeCell[][]
  getCursor(): NativeCursor
  getMode(mode: string): boolean
  getTitle(): string
  getScrollback(): number[] // [viewportOffset, totalLines, screenLines]
  scrollViewport(delta: number): void
  destroy(): void
}

interface NativeModule {
  AlacrittyTerminal: new (cols: number, rows: number, scrollbackLimit?: number) => NativeAlacrittyTerminal
}

// ═══════════════════════════════════════════════════════
// Native module loading
// ═══════════════════════════════════════════════════════

let nativeModule: NativeModule | null = null

/**
 * Load the native alacritty module. Must be called before creating backends.
 *
 * TODO: Once the native .node binary is built, this will import it.
 * For now, throws an error indicating the native module needs building.
 */
export function loadAlacrittyNative(): NativeModule {
  if (nativeModule) return nativeModule

  try {
    // TODO: Update this path once napi-rs build is configured
    // The napi-rs CLI generates platform-specific binaries:
    //   termless-alacritty-native.darwin-arm64.node
    //   termless-alacritty-native.darwin-x64.node
    //   termless-alacritty-native.linux-x64-gnu.node
    //   etc.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nativeModule = require("../native/termless-alacritty-native.node") as NativeModule
    return nativeModule
  } catch {
    throw new Error(
      "Alacritty native module not found. Build it first:\n" +
        "  1. Install Rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh\n" +
        "  2. cd packages/alacritty/native && cargo build --release\n" +
        "  3. Copy target/release/libtermless_alacritty_native.dylib to termless-alacritty-native.node",
    )
  }
}

// ═══════════════════════════════════════════════════════
// Key encoding (shared with other backends)
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

function convertNativeCell(nc: NativeCell): Cell {
  return {
    text: nc.text,
    fg: nc.fg ? ({ r: nc.fg[0]!, g: nc.fg[1]!, b: nc.fg[2]! } as RGB) : null,
    bg: nc.bg ? ({ r: nc.bg[0]!, g: nc.bg[1]!, b: nc.bg[2]! } as RGB) : null,
    bold: nc.bold,
    faint: nc.faint,
    italic: nc.italic,
    underline: nc.underline as Cell["underline"],
    strikethrough: nc.strikethrough,
    inverse: nc.inverse,
    wide: nc.wide,
  }
}

function emptyCell(): Cell {
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

// ═══════════════════════════════════════════════════════
// Backend factory
// ═══════════════════════════════════════════════════════

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

/**
 * Create an Alacritty backend for termless.
 *
 * Uses alacritty_terminal (Rust crate via napi-rs) for headless terminal
 * emulation — the same VT parser and grid implementation used by the
 * Alacritty terminal emulator.
 *
 * Requires the native module to be built first. See README.md for build
 * instructions.
 */
export function createAlacrittyBackend(opts?: Partial<TerminalOptions>): TerminalBackend {
  let term: NativeAlacrittyTerminal | null = null

  function ensureTerm(): NativeAlacrittyTerminal {
    if (!term) throw new Error("alacritty backend not initialized — call init() first")
    return term
  }

  function init(options: TerminalOptions): void {
    if (term) {
      term.destroy()
    }

    const native = loadAlacrittyNative()
    term = new native.AlacrittyTerminal(options.cols, options.rows, options.scrollbackLimit ?? 1000)
  }

  if (opts) {
    init({
      cols: opts.cols ?? DEFAULT_COLS,
      rows: opts.rows ?? DEFAULT_ROWS,
      scrollbackLimit: opts.scrollbackLimit,
    })
  }

  function destroy(): void {
    if (term) {
      term.destroy()
      term = null
    }
  }

  function feed(data: Uint8Array): void {
    const t = ensureTerm()
    t.feed(Buffer.from(data))
  }

  function resize(cols: number, rows: number): void {
    ensureTerm().resize(cols, rows)
  }

  function reset(): void {
    const t = ensureTerm()
    // RIS (Reset to Initial State)
    t.feed(Buffer.from("\x1bc"))
  }

  function getText(): string {
    return ensureTerm().getText()
  }

  function getTextRange(startRow: number, startCol: number, endRow: number, endCol: number): string {
    return ensureTerm().getTextRange(startRow, startCol, endRow, endCol)
  }

  function getCell(row: number, col: number): Cell {
    const t = ensureTerm()
    try {
      return convertNativeCell(t.getCell(row, col))
    } catch {
      return emptyCell()
    }
  }

  function getLine(row: number): Cell[] {
    const t = ensureTerm()
    try {
      return t.getLine(row).map(convertNativeCell)
    } catch {
      return []
    }
  }

  function getLines(): Cell[][] {
    const t = ensureTerm()
    try {
      return t.getLines().map((row) => row.map(convertNativeCell))
    } catch {
      return []
    }
  }

  function getCursor(): CursorState {
    const t = ensureTerm()
    const nc = t.getCursor()
    return {
      x: nc.x,
      y: nc.y,
      visible: nc.visible,
      style: nc.style as CursorStyle,
    }
  }

  function getMode(mode: TerminalMode): boolean {
    return ensureTerm().getMode(mode)
  }

  function getTitle(): string {
    return ensureTerm().getTitle()
  }

  function getScrollback(): ScrollbackState {
    const [viewportOffset, totalLines, screenLines] = ensureTerm().getScrollback()
    return {
      viewportOffset: viewportOffset!,
      totalLines: totalLines!,
      screenLines: screenLines!,
    }
  }

  function scrollViewport(delta: number): void {
    ensureTerm().scrollViewport(delta)
  }

  const capabilities: TerminalCapabilities = {
    name: "alacritty",
    version: "0.25.1",
    truecolor: true,
    kittyKeyboard: true, // alacritty_terminal supports kitty keyboard protocol
    kittyGraphics: false,
    sixel: false,
    osc8Hyperlinks: true,
    semanticPrompts: false,
    unicode: "15.1",
    reflow: true,
    extensions: new Set(),
  }

  return {
    name: "alacritty",
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
