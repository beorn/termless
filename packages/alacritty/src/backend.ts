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
} from "../../../src/terminal/types.ts"
import { encodeKeyToAnsi } from "../../../src/terminal/key-encoding.ts"

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
  /** Read pending response data (DA1/DA2/DSR). Returns null if no responses pending or method not available. */
  readResponse?(): Buffer | null
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
  let cols = DEFAULT_COLS
  let rows = DEFAULT_ROWS

  function ensureTerm(): NativeAlacrittyTerminal {
    if (!term) throw new Error("alacritty backend not initialized — call init() first")
    return term
  }

  function init(options: TerminalOptions): void {
    if (term) {
      term.destroy()
    }

    const native = loadAlacrittyNative()
    cols = options.cols
    rows = options.rows
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

  /**
   * Standard cell metrics used for synthetic CSI 14t / 18t window-op
   * responses. The alacritty backend (alacritty_terminal via napi-rs)
   * exposes only a cell grid — there's no native window-pixel concept,
   * so we synthesize 14t/18t from `rows × cols × typical cell metrics`.
   * silvery's `resolveMouseOption()` divides pixel coords by cell metrics
   * to recover cell coords for SGR-Pixels (1016) mouse hit-testing.
   * 8 × 17 is the typical Iosevka/JetBrains Mono cell at 12pt 96 DPI —
   * what matters is the ratio matches the backend's cell grid
   * (one cell = one cell, invariant).
   */
  const CELL_W_PX = 8
  const CELL_H_PX = 17

  // CSI 14t = text-area pixel-size query; reply CSI 4;h;w t
  // CSI 18t = text-area cell-size query; reply CSI 8;h;w t
  const CSI_14t_RE = /\x1b\[14t/g
  const CSI_18t_RE = /\x1b\[18t/g

  function feed(data: Uint8Array): void {
    const t = ensureTerm()
    t.feed(Buffer.from(data))

    // Drain DA1/DA2/DSR responses and forward to the terminal layer
    if (backend.onResponse && t.readResponse) {
      const response = t.readResponse()
      if (response && response.length > 0) {
        backend.onResponse(new Uint8Array(response))
      }
    }

    // Synthesize CSI 14t / 18t window-op probe responses from our
    // tracked cell grid (alacritty_terminal has no window-pixel concept).
    if (backend.onResponse) {
      const text = new TextDecoder().decode(data)
      CSI_14t_RE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = CSI_14t_RE.exec(text)) !== null) {
        const heightPx = rows * CELL_H_PX
        const widthPx = cols * CELL_W_PX
        backend.onResponse(new TextEncoder().encode(`\x1b[4;${heightPx};${widthPx}t`))
      }
      CSI_18t_RE.lastIndex = 0
      while ((m = CSI_18t_RE.exec(text)) !== null) {
        backend.onResponse(new TextEncoder().encode(`\x1b[8;${rows};${cols}t`))
      }
    }
  }

  function resize(newCols: number, newRows: number): void {
    ensureTerm().resize(newCols, newRows)
    cols = newCols
    rows = newRows
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
      col: nc.x,
      row: nc.y,
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
      viewportTop: viewportOffset!,
      totalRows: totalLines!,
      screenRows: screenLines!,
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

  // TODO(native): Wire DA1/DA2/DSR response capture in lib.rs.
  // The alacritty_terminal Processor generates responses via the Term's writer,
  // but the EventProxy doesn't capture them. Steps:
  //   1. Add `response_buf: Arc<Mutex<Vec<u8>>>` to EventProxy
  //   2. Implement io::Write for EventProxy, writing to response_buf
  //   3. Pass EventProxy as the writer to Processor::advance()
  //   4. Add #[napi] pub fn read_response(&self) -> Option<Buffer> that drains response_buf
  // The TS side is already wired — it calls readResponse() after each feed().

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
