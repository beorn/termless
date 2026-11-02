import { adapterDeclaration } from "./adapter-sources.ts"
/**
 * Rust vt100 backend for termless.
 *
 * Wraps the doy/vt100-rust crate via napi-rs native bindings to implement
 * the TerminalBackend interface -- same VT parser used by many Rust terminal
 * projects, but headless via native Node addon.
 *
 * The prebuilt target is Linux x64 glibc.
 */

import type {
  AdapterSourcesExtension,
  TerminalBackend,
  TerminalOptions,
  Cell,
  Cursor,
  TerminalMode,
  ScrollbackState,
  TerminalCapabilities,
  Color,
  MouseEncodingExtension,
  MouseEvent,
} from "../../../src/terminal/types.ts"
import { encodeKeyToAnsi } from "../../../src/terminal/key-encoding.ts"
import { encodeMouseReport, type MouseEncodingState } from "../../../src/terminal/mouse-encoding.ts"
import { loadNativeAddon } from "../../../src/load-native.ts"

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
  getMode(mode: string): boolean | null
  getTitle(): string
  getIconLabel(): string
  getClipboardState(): {
    writes: { selector: string; payload: string; text?: string; decodeError?: string }[]
    pasteSelector?: string
  }
  getScrollback(): NapiScrollback
  scrollViewport(delta: number): void
  /** Read pending response data (DA1/DA2/DSR). Returns null if no responses pending or method not available. */
  readResponse?(): Buffer | null
}

/**
 * Adapter-private mouse state getters on the native class. Deliberately NOT members of the exported
 * Vt100RustTerminal type: only encodeMouse reads them. Values are DEC private mode numbers, 0 = none/default.
 */
interface Vt100RustMouseState {
  getMouseProtocolMode?(): number
  getMouseProtocolEncoding?(): number
}

const MOUSE_TRACKINGS: readonly MouseEncodingState["tracking"][] = [0, 9, 1000, 1002, 1003]
const MOUSE_ENCODINGS: ReadonlyMap<number, MouseEncodingState["encoding"]> = new Map([
  [0, "legacy"],
  [1005, "utf8"],
  [1006, "sgr"],
])

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
    nativeModule = loadNativeAddon<NativeModule>({
      callerUrl: import.meta.url,
      packageName: "@termless/vt100-rust",
      candidates: ["../termless-vt100-rust.node"],
      prebuiltScope: "linux-x64-glibc only",
    })
    return nativeModule
  } catch (error) {
    loadError = error as Error
    throw loadError
  }
}

// ===============================================================
// Cell conversion
// ===============================================================

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
    blink: null,
    overline: null,
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
  overline: null,
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
export function createVt100RustBackend(
  opts?: Partial<TerminalOptions>,
  native?: NativeModule,
): TerminalBackend & AdapterSourcesExtension & MouseEncodingExtension {
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
    const totalRows = getScrollback().totalRows
    for (let row = 0; row < totalRows; row++) {
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
      visible: cursor.visible,
      style: (cursor.style as Cursor["style"]) ?? "block",
    }
  }

  function getMode(mode: TerminalMode): boolean | null {
    return ensureTerm().getMode(mode)
  }

  function getTitle(): string {
    return ensureTerm().getTitle()
  }

  function getIconLabel(): string {
    return ensureTerm().getIconLabel()
  }

  function getClipboardState() {
    return ensureTerm().getClipboardState()
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
    name: "vt100-rust",
    version: "0.16.2",
    truecolor: true,
    kittyKeyboard: false,
    kittyGraphics: false,
    sixel: false,
    osc8Hyperlinks: false,
    semanticPrompts: false,
    unicode: "13.0",
    reflow: false,
    extensions: new Set(["adapter-sources", "mouse-encoding"]),
  }

  // TODO(native): Wire DA1/DA2/DSR response capture in lib.rs.
  // The doy/vt100 crate doesn't generate terminal responses (DA1/DA2/DSR).
  // It's a pure VT parser without a response generation mechanism.
  // If the crate adds response support in the future, steps would be:
  //   1. Capture output from the parser into a buffer
  //   2. Add #[napi] pub fn read_response(&self) -> Option<Buffer> that drains it
  // The TS side is already wired — it calls readResponse() after each feed().

  /**
   * vt100 0.16.2 stores one effective protocol and one encoding (screen.rs:683-700), so the stored pair is exact.
   * It cannot store 1015/1016; those leave the previous encoding, which is reported as stored, never relabelled.
   */
  function encodeMouse(event: MouseEvent): Uint8Array | null {
    const t = ensureTerm() as Vt100RustTerminal & Vt100RustMouseState
    if (typeof t.getMouseProtocolMode !== "function" || typeof t.getMouseProtocolEncoding !== "function") {
      throw new Error("mouse encoding unavailable: native addon has no mouse protocol getters")
    }
    const mode = t.getMouseProtocolMode()
    const encodingMode = t.getMouseProtocolEncoding()
    const tracking = MOUSE_TRACKINGS.find((known) => known === mode)
    const encoding = MOUSE_ENCODINGS.get(encodingMode)
    if (tracking === undefined || encoding === undefined) {
      throw new Error(`mouse encoding unavailable: native mouse state protocol ${mode} encoding ${encodingMode}`)
    }
    return encodeMouseReport(event, { tracking, encoding })
  }

  const backend: TerminalBackend & AdapterSourcesExtension & MouseEncodingExtension = {
    getAdapterSources: () => adapterDeclaration.sources,
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
    getRow: getLine,
    getRows: getLines,
    getCursor,
    getMode,
    getTitle,
    getIconLabel,
    getClipboardState,
    getScrollback,
    scrollViewport,
    encodeKey: encodeKeyToAnsi,
    encodeMouse,
    capabilities,
  }

  return backend
}
