/**
 * Rust vt100 backend for termless.
 *
 * Wraps the doy/vt100-rust crate via napi-rs native bindings to implement
 * the TerminalBackend interface -- same VT parser used by many Rust terminal
 * projects, but headless via native Node addon.
 *
 * Requires the native module to be built first:
 *   cd packages/vt100-rust/native && cargo build --release
 *   cp target/release/libtermless_vt100_rust_native.dylib ../termless-vt100-rust.node
 *
 * TODO: Set up @napi-rs/cli build pipeline for cross-platform prebuilds.
 */

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

// ===============================================================
// Native module loading
// ===============================================================

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

interface Vt100RustTerminal {
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
  /** Read pending response data (DA1/DA2/DSR). Returns null if no responses pending or method not available. */
  readResponse?(): Buffer | null
}

interface NativeModule {
  Vt100RustTerminal: new (cols: number, rows: number, scrollbackLimit?: number) => Vt100RustTerminal
}

let nativeModule: NativeModule | null = null
let loadError: Error | null = null

/**
 * Load the native vt100-rust module. Call once before creating backends.
 * Returns the native module, or throws if the .node file is missing.
 */
export function loadVt100RustNative(): NativeModule {
  if (nativeModule) return nativeModule
  if (loadError) throw loadError

  try {
    // Try loading the prebuilt native addon
    // The .node file should be at packages/vt100-rust/termless-vt100-rust.node
    const mod = require("../termless-vt100-rust.node") as NativeModule
    nativeModule = mod
    return mod
  } catch (e) {
    loadError = new Error(
      "Failed to load vt100-rust native module. Build it first:\n" +
        "  cd packages/vt100-rust/native && cargo build --release\n" +
        "  cp target/release/libtermless_vt100_rust_native.dylib ../termless-vt100-rust.node\n" +
        `\nOriginal error: ${e instanceof Error ? e.message : String(e)}`,
    )
    throw loadError
  }
}

// ===============================================================
// Cell conversion
// ===============================================================

function convertNapiCell(cell: NapiCell): Cell {
  const fg: RGB | null = cell.fgIsDefault ? null : { r: cell.fgR, g: cell.fgG, b: cell.fgB }
  const bg: RGB | null = cell.bgIsDefault ? null : { r: cell.bgR, g: cell.bgG, b: cell.bgB }

  return {
    char: cell.text,
    fg,
    bg,
    bold: cell.bold,
    dim: cell.faint,
    italic: cell.italic,
    underline: cell.underline === "none" ? false : (cell.underline as Cell["underline"]),
    underlineColor: null,
    strikethrough: cell.strikethrough,
    inverse: cell.inverse,
    blink: false,
    hidden: false,
    wide: cell.wide,
    continuation: false,
    hyperlink: null,
  }
}

const EMPTY_CELL: Cell = {
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

// ===============================================================
// Backend factory
// ===============================================================

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

/**
 * Create a vt100-rust backend for termless.
 *
 * Uses the doy/vt100-rust crate via napi-rs for headless terminal emulation.
 * The native module must be built and available before calling this function.
 *
 * @param opts - Optional terminal dimensions for eager initialization
 * @param native - Optional pre-loaded native module (for test isolation)
 */
export function createVt100RustBackend(opts?: Partial<TerminalOptions>, native?: NativeModule): TerminalBackend {
  let term: Vt100RustTerminal | null = null
  let nativeMod: NativeModule | null = native ?? null
  let cols = DEFAULT_COLS
  let rows = DEFAULT_ROWS

  function ensureNative(): NativeModule {
    if (!nativeMod) {
      nativeMod = loadVt100RustNative()
    }
    return nativeMod
  }

  function ensureTerm(): Vt100RustTerminal {
    if (!term) throw new Error("vt100-rust backend not initialized -- call init() first")
    return term
  }

  function init(options: TerminalOptions): void {
    const mod = ensureNative()

    cols = options.cols
    rows = options.rows

    term = new mod.Vt100RustTerminal(cols, rows, options.scrollbackLimit ?? 1000)
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

    // Drain DA1/DA2/DSR responses and forward to the terminal layer
    if (backend.onResponse && t.readResponse) {
      const response = t.readResponse()
      if (response && response.length > 0) {
        backend.onResponse(new Uint8Array(response))
      }
    }
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
    name: "vt100-rust",
    version: "0.1.0",
    truecolor: true,
    kittyKeyboard: false,
    kittyGraphics: false,
    sixel: false,
    osc8Hyperlinks: false,
    semanticPrompts: false,
    unicode: "13.0",
    reflow: false,
    extensions: new Set(),
  }

  // TODO(native): Wire DA1/DA2/DSR response capture in lib.rs.
  // The doy/vt100 crate doesn't generate terminal responses (DA1/DA2/DSR).
  // It's a pure VT parser without a response generation mechanism.
  // If the crate adds response support in the future, steps would be:
  //   1. Capture output from the parser into a buffer
  //   2. Add #[napi] pub fn read_response(&self) -> Option<Buffer> that drains it
  // The TS side is already wired — it calls readResponse() after each feed().

  const backend: TerminalBackend = {
    name: "vt100-rust",
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
