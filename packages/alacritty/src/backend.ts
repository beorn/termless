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
  TerminalMode,
  ScrollbackState,
  TerminalCapabilities,
  RGB,
} from "../../../src/types.ts"
import { encodeKeyToAnsi } from "../../../src/key-encoding.ts"

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
    nativeModule = require("../termless-alacritty-native.node") as NativeModule
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
// Cell conversion
// ═══════════════════════════════════════════════════════

function convertNativeCell(nc: NativeCell): Cell {
  return {
    char: nc.text,
    fg: nc.fg ? ({ r: nc.fg[0]!, g: nc.fg[1]!, b: nc.fg[2]! } as RGB) : null,
    bg: nc.bg ? ({ r: nc.bg[0]!, g: nc.bg[1]!, b: nc.bg[2]! } as RGB) : null,
    bold: nc.bold,
    dim: nc.faint,
    italic: nc.italic,
    underline: nc.underline === "none" ? false : (nc.underline as Cell["underline"]),
    underlineColor: null,
    strikethrough: nc.strikethrough,
    inverse: nc.inverse,
    blink: false,
    hidden: false,
    wide: nc.wide,
    continuation: false,
    hyperlink: null,
  }
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

  // TODO: Native module doesn't capture DA1/DA2/DSR responses yet.
  // The alacritty_terminal Processor generates responses via the Term's writer,
  // but the EventProxy doesn't capture them. Need to add a response buffer
  // in lib.rs (e.g., Arc<Mutex<Vec<u8>>>) and expose a readResponse() napi method.

  const backend: TerminalBackend = {
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

  return backend
}
