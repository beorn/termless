/**
 * WezTerm backend for termless.
 *
 * Wraps the wezterm-term Rust crate (tattoy fork) via napi-rs native bindings
 * to implement the TerminalBackend interface — same VT parser that powers the
 * WezTerm terminal emulator, but headless via native Node addon.
 *
 * The prebuilt target is Linux x64 glibc.
 */

import type {
  TerminalBackend,
  TerminalOptions,
  Cell,
  Cursor,
  TerminalMode,
  ScrollbackState,
  TerminalCapabilities,
  Color,
  ReplyDeliveryExtension,
} from "../../../src/terminal/types.ts"
import { encodeKeyToAnsi } from "../../../src/terminal/key-encoding.ts"
import { loadNativeAddon } from "../../../src/load-native.ts"
import { replyDelivery } from "./reply-delivery.ts"

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
  getMode(mode: string): boolean | null
  getTitle(): string
  getScrollback(): NapiScrollback
  scrollViewport(delta: number): void
  /** Read pending response data (DA1/DA2/DSR/DECRPM/window-ops). Returns null if no responses pending. */
  readResponse(): Buffer | null
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
    nativeModule = loadNativeAddon<NativeModule>({
      callerUrl: import.meta.url,
      packageName: "@termless/wezterm",
      candidates: ["../termless-wezterm.node"],
      prebuiltScope: "linux-x64-glibc only",
    })
    return nativeModule
  } catch (error) {
    loadError = error as Error
    throw loadError
  }
}

// ═══════════════════════════════════════════════════════
// Cell conversion
// ═══════════════════════════════════════════════════════

function convertNapiCell(cell: NapiCell): Cell {
  const fg: Color | null = cell.fgIsDefault ? null : { r: cell.fgR, g: cell.fgG, b: cell.fgB }
  const bg: Color | null = cell.bgIsDefault ? null : { r: cell.bgR, g: cell.bgG, b: cell.bgB }

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
export function createWeztermBackend(opts?: Partial<TerminalOptions>, native?: NativeModule): TerminalBackend {
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

    // Drain DA1/DA2/DSR/DECRPM/window-op responses and forward to the terminal layer
    const response = t.readResponse()
    if (response && response.length > 0) {
      backend.onResponse?.(new Uint8Array(response))
    }
  }

  function resize(newCols: number, newRows: number): void {
    const t = ensureTerm()
    t.resize(newCols, newRows)
    cols = newCols
    rows = newRows
  }

  function reset(): void {
    const t = ensureTerm()
    t.reset()
    t.readResponse()
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

  function getCursor(): Cursor {
    const t = ensureTerm()
    const cursor = t.getCursor()
    return {
      col: cursor.x,
      row: cursor.y,
      x: cursor.x,
      y: cursor.y,
      // TODO: cursor.visible is hardcoded to true in the native module (lib.rs).
      // DECTCEM (\x1b[?25l / \x1b[?25h) tracking needs to be implemented in
      // the Rust side to get accurate visibility state.
      visible: cursor.visible,
      style: (cursor.style as Cursor["style"]) ?? "block",
    }
  }

  function getMode(mode: TerminalMode): boolean {
    return ensureTerm().getMode(mode) as unknown as boolean
  }

  function getTitle(): string {
    return ensureTerm().getTitle()
  }

  function getScrollback(): ScrollbackState {
    const t = ensureTerm()
    const sb = t.getScrollback()
    return {
      viewportTop: sb.viewportOffset,
      totalRows: sb.totalLines,
      screenRows: sb.screenLines,
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
    version: "0.1.0-fork.5",
    truecolor: true,
    kittyKeyboard: true,
    kittyGraphics: false, // Not available in headless mode
    sixel: true,
    // The NAPI cell bridge does not expose parsed URI metadata.
    osc8Hyperlinks: false,
    semanticPrompts: true,
    unicode: "15.1",
    reflow: true,
    extensions: new Set(["reply-delivery"]),
  }

  const backend: TerminalBackend & ReplyDeliveryExtension = {
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
    getRow: getLine,
    getRows: getLines,
    getCursor,
    getMode,
    getTitle,
    getScrollback,
    scrollViewport,
    encodeKey: encodeKeyToAnsi,
    capabilities,
    replyDelivery,
  }

  return backend
}
