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
  TerminalMode,
  ScrollbackState,
  TerminalCapabilities,
  RGB,
} from "../../../src/types.ts"
import { encodeKeyToAnsi } from "../../../src/key-encoding.ts"

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
      // TODO: cursor.visible is hardcoded to true in the native module (lib.rs).
      // DECTCEM (\x1b[?25l / \x1b[?25h) tracking needs to be implemented in
      // the Rust side to get accurate visibility state.
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
