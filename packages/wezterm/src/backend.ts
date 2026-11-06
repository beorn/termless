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
  AdapterSourcesExtension,
  TerminalBackend,
  TerminalOptions,
  Cell,
  Cursor,
  TerminalMode,
  ModeState,
  ScrollbackState,
  TerminalCapabilities,
  Color,
  HyperlinkExtension,
  OscMetadataExtension,
  PasteEncodingExtension,
  KeyDescriptor,
  KeyEncodingExtension,
  MouseEvent,
  MouseEncodingExtension,
} from "../../../src/terminal/types.ts"
import { declaredPixelGeometry } from "../../../src/terminal/types.ts"
import { loadNativeAddon } from "../../../src/load-native.ts"
import { adapterDeclaration } from "./adapter-sources.ts"

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
  ulR: number
  ulG: number
  ulB: number
  ulIsDefault: boolean
  bold: boolean
  faint: boolean
  italic: boolean
  underline: string
  strikethrough: boolean
  inverse: boolean
  blink: boolean
  overline: boolean
  hidden: boolean
  wide: boolean
  hyperlink: string | null
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
  encodePaste(text: string): Buffer
  encodeKey(key: string, shift: boolean, ctrl: boolean, alt: boolean, superKey: boolean): Buffer
  encodeMouse(x: number, y: number, button: string, action: string, shift: boolean, ctrl: boolean, alt: boolean): Buffer
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
  /** Every engine-emitted OSC 9/777 toast since construction, in order; title null where the engine sets none. */
  getToasts(): { title: string | null; body: string }[]
  getProgress(): { state: number; value: number | null }
  getCwd(): string | null
  getScrollback(): NapiScrollback
  scrollViewport(delta: number): void
  /** Read pending response data (DA1/DA2/DSR/DECRPM/window-ops). Returns null if no responses pending. */
  readResponse(): Buffer | null
}

interface NativeModule {
  WeztermTerminal: new (
    cols: number,
    rows: number,
    scrollbackLimit?: number,
    cellWidth?: number,
    cellHeight?: number,
  ) => WeztermTerminal
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
  if (cell.hyperlink !== null && typeof cell.hyperlink !== "string") {
    throw new Error("wezterm native cell.hyperlink must be a string or null")
  }
  const fg: Color | null = cell.fgIsDefault ? null : { r: cell.fgR, g: cell.fgG, b: cell.fgB }
  const bg: Color | null = cell.bgIsDefault ? null : { r: cell.bgR, g: cell.bgG, b: cell.bgB }
  if (
    typeof cell.ulIsDefault !== "boolean" ||
    (!cell.ulIsDefault &&
      ![cell.ulR, cell.ulG, cell.ulB].every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255))
  ) {
    throw new Error("wezterm native underline color must report default or RGB; rebuild the native addon")
  }
  const underlineColor: Color | null = cell.ulIsDefault ? null : { r: cell.ulR, g: cell.ulG, b: cell.ulB }
  if (typeof cell.hidden !== "boolean") {
    throw new Error("wezterm native cell.hidden must be a boolean; rebuild the native addon")
  }

  return {
    char: cell.text,
    fg,
    bg,
    bold: cell.bold,
    dim: cell.faint,
    italic: cell.italic,
    underline: cell.underline === "none" ? false : (cell.underline as Cell["underline"]),
    underlineColor,
    strikethrough: cell.strikethrough,
    inverse: cell.inverse,
    blink: cell.blink,
    overline: cell.overline,
    hidden: cell.hidden,
    wide: cell.wide,
    continuation: false,
    hyperlink: cell.hyperlink,
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
  overline: false,
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
export function createWeztermBackend(
  opts?: Partial<TerminalOptions>,
  native?: NativeModule,
  // oxlint-disable-next-line typescript/no-deprecated -- This registered adapter retains the TerminalBackend lifecycle until unterm phase A4.
): TerminalBackend &
  HyperlinkExtension &
  PasteEncodingExtension &
  KeyEncodingExtension &
  MouseEncodingExtension &
  AdapterSourcesExtension &
  Pick<Required<OscMetadataExtension>, "getToasts" | "getProgress" | "getCwd"> {
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

    const geometry = declaredPixelGeometry("wezterm", options)
    term = new mod.WeztermTerminal(
      cols,
      rows,
      options.scrollbackLimit ?? 1000,
      geometry?.cellWidth,
      geometry?.cellHeight,
    )
  }

  // Eagerly init if opts provided
  if (opts) {
    init({
      cols: opts.cols ?? DEFAULT_COLS,
      rows: opts.rows ?? DEFAULT_ROWS,
      scrollbackLimit: opts.scrollbackLimit,
      pixelGeometry: opts.pixelGeometry,
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
    const totalLines = ensureTerm().getScrollback().totalLines
    for (let row = 0; row < totalLines; row++) {
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

  function getMode(mode: TerminalMode): ModeState {
    return ensureTerm().getMode(mode)
  }

  function getCwd(): string | null {
    return ensureTerm().getCwd()
  }

  function getToasts(): { title: string | null; body: string }[] {
    const t = ensureTerm()
    if (typeof t.getToasts !== "function") {
      throw new Error(
        "The loaded WezTerm native addon predates getToasts; rebuild it:\n  cd packages/wezterm/native && cargo build --release",
      )
    }
    return t.getToasts().map((toast) => ({ title: toast.title, body: toast.body }))
  }

  function encodeKey(key: KeyDescriptor): Uint8Array {
    const t = ensureTerm()
    // N-API replaces lone UTF-16 surrogates before Rust validates the scalar.
    if (/[\uD800-\uDFFF]/u.test(key.key)) {
      throw new Error("WezTerm key must contain a valid Unicode scalar")
    }
    if (typeof t.encodeKey !== "function") {
      throw new Error(
        "The loaded WezTerm native addon predates encodeKey; rebuild and copy it from the Termless root:\n  nix shell .#native-tools --command bun run --cwd packages/wezterm build:native",
      )
    }
    return new Uint8Array(t.encodeKey(key.key, !!key.shift, !!key.ctrl, !!key.alt, !!key.super))
  }

  function encodePaste(text: string): Uint8Array {
    const t = ensureTerm()
    if (typeof t.encodePaste !== "function") {
      throw new Error(
        "The loaded WezTerm native addon predates encodePaste; rebuild and copy it from the Termless root:\n  nix shell .#native-tools --command bun run --cwd packages/wezterm build:native",
      )
    }
    return new Uint8Array(t.encodePaste(text))
  }

  function encodeMouse(event: MouseEvent): Uint8Array | null {
    const t = ensureTerm()
    if (event.pixel !== undefined) {
      throw new Error("mouse encoding unavailable: WezTerm pixel-coordinate path is not bound")
    }
    if (typeof t.encodeMouse !== "function") {
      throw new Error(
        "The loaded WezTerm native addon predates encodeMouse; rebuild and copy it from the Termless root:\n  nix shell .#native-tools --command bun run --cwd packages/wezterm build:native",
      )
    }
    const bytes = t.encodeMouse(event.x, event.y, event.button, event.action, !!event.shift, !!event.ctrl, !!event.alt)
    return bytes.length === 0 ? null : new Uint8Array(bytes)
  }

  function getProgress(): { state: number; value: number | null } {
    const t = ensureTerm()
    if (typeof t.getProgress !== "function") {
      throw new Error(
        "The loaded WezTerm native addon predates getProgress; rebuild and copy it from the Termless root:\n  nix shell .#native-tools --command bun run --cwd packages/wezterm build:native",
      )
    }
    return t.getProgress()
  }

  function getTitle(): string {
    return ensureTerm().getTitle()
  }

  function getScrollback(): ScrollbackState {
    const t = ensureTerm()
    const sb = t.getScrollback()
    // The headless fork exposes no viewport scroll state, so the viewport is pinned at
    // the live bottom and the absolute start row is totalLines - screenLines (0 with an
    // offset of 0). Passing the bottom-relative offset straight through published
    // "oldest retained row" instead.
    const viewportTop = sb.totalLines - sb.screenLines - sb.viewportOffset
    return {
      viewportTop,
      totalRows: sb.totalLines,
      screenRows: sb.screenLines,
      viewportOffset: viewportTop,
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
    osc8Hyperlinks: true,
    semanticPrompts: true,
    unicode: "15.1",
    reflow: true,
    productViewport: {
      available: false,
      reason:
        "WezTerm Screen library subject (tattoy-wezterm-term 0.1.0-fork.5) owns history and stable rows but no user viewport: src/screen.rs:15-45,335,493,522,527; scroll_up at :645 mutates content. Application pane viewports are a different subject.",
    },
    // Parsed toasts, current progress and engine-owned Cwd; no raw OSC 9/777 payload.
    extensions: new Set([
      "adapter-sources",
      "hyperlinks",
      "osc-metadata",

      "paste-encoding",
      "key-encoding",
      "mouse-encoding",
    ]),
  }

  // oxlint-disable-next-line typescript/no-deprecated -- This registered adapter retains the TerminalBackend lifecycle until unterm phase A4.
  const backend: TerminalBackend &
    HyperlinkExtension &
    PasteEncodingExtension &
    KeyEncodingExtension &
    MouseEncodingExtension &
    AdapterSourcesExtension &
    Pick<Required<OscMetadataExtension>, "getToasts" | "getProgress" | "getCwd"> = {
    getAdapterSources: () => adapterDeclaration.sources,
    name: "wezterm",
    init,
    destroy,
    feed,
    resize,
    reset,
    getText,
    getTextRange,
    getCell,
    getHyperlinkAt(row, col) {
      return getCell(row, col).hyperlink
    },
    getLine,
    getLines,
    getRow: getLine,
    getRows: getLines,
    getCursor,
    getMode,
    getTitle,
    getIconLabel: () => ensureTerm().getIconLabel(),
    getToasts,
    getProgress,
    getCwd,
    getScrollback,
    scrollViewport,
    encodeKey,
    encodePaste,
    encodeMouse,
    capabilities,
  }

  return backend
}
