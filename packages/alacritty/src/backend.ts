/**
 * Alacritty backend for termless.
 *
 * Wraps alacritty_terminal (Rust) via napi-rs to implement the TerminalBackend
 * interface — same terminal emulation logic that runs in Alacritty, but headless.
 * The prebuilt target is Linux x64 glibc.
 */

import type {
  AdapterSourcesExtension,
  TerminalBackend,
  TerminalOptions,
  Cell,
  Cursor,
  CursorStyle,
  TerminalMode,
  ModeState,
  ScrollbackState,
  TerminalCapabilities,
  Color,
  ReplyDeliveryExtension,
  HyperlinkExtension,
  MouseEvent,
  MouseEncodingExtension,
} from "../../../src/terminal/types.ts"
import { declaredPixelGeometry } from "../../../src/terminal/types.ts"
import { encodeKeyToAnsi } from "../../../src/terminal/key-encoding.ts"
import { encodeMouseReport, type MouseEncodingState } from "../../../src/terminal/mouse-encoding.ts"
import { loadNativeAddon } from "../../../src/load-native.ts"
import { adapterDeclaration, replyDelivery } from "./reply-delivery.ts"

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
  underlineColor: [number, number, number] | null
  strikethrough: boolean
  inverse: boolean
  wide: boolean
  hyperlink: string | null
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
  getMode(mode: string): boolean | null
  getTitle(): string
  getScrollback(): [number, number, number] // [viewportOffset, totalLines, screenLines]
  scrollViewport(delta: number): void
  destroy(): void
  /** Read pending response data (DA1/DA2/DSR/DECRPM/window-ops). Returns null if no responses pending. */
  readResponse(): Buffer | null
}

interface NativeModule {
  AlacrittyTerminal: new (
    cols: number,
    rows: number,
    scrollbackLimit?: number,
    cellWidth?: number,
    cellHeight?: number,
  ) => NativeAlacrittyTerminal
}

// ═══════════════════════════════════════════════════════
// Native module loading
// ═══════════════════════════════════════════════════════

let nativeModule: NativeModule | null = null

/** Load the native alacritty module. Must be called before creating backends. */
export function loadAlacrittyNative(): NativeModule {
  if (nativeModule) return nativeModule
  nativeModule = loadNativeAddon<NativeModule>({
    callerUrl: import.meta.url,
    packageName: "@termless/alacritty",
    candidates: ["../termless-alacritty-native.node"],
    prebuiltScope: "linux-x64-glibc only",
  })
  return nativeModule
}

// ═══════════════════════════════════════════════════════
// Cell conversion
// ═══════════════════════════════════════════════════════

function convertNativeCell(nc: NativeCell): Cell {
  if (nc.hyperlink !== null && typeof nc.hyperlink !== "string") {
    throw new Error("alacritty backend: native cell hyperlink must be a string or null")
  }
  return {
    char: nc.text,
    fg: nc.fg ? ({ r: nc.fg[0]!, g: nc.fg[1]!, b: nc.fg[2]! } as Color) : null,
    bg: nc.bg ? ({ r: nc.bg[0]!, g: nc.bg[1]!, b: nc.bg[2]! } as Color) : null,
    bold: nc.bold,
    dim: nc.faint,
    italic: nc.italic,
    underline: nc.underline === "none" ? false : (nc.underline as Cell["underline"]),
    underlineColor: nc.underlineColor
      ? { r: nc.underlineColor[0], g: nc.underlineColor[1], b: nc.underlineColor[2] }
      : null,
    strikethrough: nc.strikethrough,
    inverse: nc.inverse,
    blink: null,
    overline: null,
    hidden: false,
    wide: nc.wide,
    continuation: false,
    hyperlink: nc.hyperlink,
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
export function createAlacrittyBackend(
  opts?: Partial<TerminalOptions>,
): TerminalBackend & ReplyDeliveryExtension & HyperlinkExtension & AdapterSourcesExtension {
  let term: NativeAlacrittyTerminal | null = null

  function ensureTerm(): NativeAlacrittyTerminal {
    if (!term) throw new Error("alacritty backend not initialized — call init() first")
    return term
  }

  function init(options: TerminalOptions): void {
    const geometry = declaredPixelGeometry("alacritty", options)
    if (term) {
      term.destroy()
    }

    const native = loadAlacrittyNative()
    term = new native.AlacrittyTerminal(
      options.cols,
      options.rows,
      options.scrollbackLimit ?? 1000,
      geometry?.cellWidth,
      geometry?.cellHeight,
    )
  }

  if (opts) {
    init({
      cols: opts.cols ?? DEFAULT_COLS,
      rows: opts.rows ?? DEFAULT_ROWS,
      scrollbackLimit: opts.scrollbackLimit,
      pixelGeometry: opts.pixelGeometry,
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

    // Drain DA1/DA2/DSR/DECRPM/window-op responses and forward to the terminal layer
    const response = t.readResponse()
    if (response && response.length > 0) {
      backend.onResponse?.(new Uint8Array(response))
    }
  }

  function resize(newCols: number, newRows: number): void {
    ensureTerm().resize(newCols, newRows)
  }

  function reset(): void {
    const t = ensureTerm()
    // RIS (Reset to Initial State)
    t.feed(Buffer.from("\x1bc"))
    t.readResponse()
  }

  function getText(): string {
    return ensureTerm().getText()
  }

  function getTextRange(startRow: number, startCol: number, endRow: number, endCol: number): string {
    return ensureTerm().getTextRange(startRow, startCol, endRow, endCol)
  }

  function getCell(row: number, col: number): Cell {
    return convertNativeCell(ensureTerm().getCell(row, col))
  }

  function getLine(row: number): Cell[] {
    return ensureTerm().getLine(row).map(convertNativeCell)
  }

  function getLines(): Cell[][] {
    return ensureTerm()
      .getLines()
      .map((row) => row.map(convertNativeCell))
  }

  function getCursor(): Cursor {
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

  function getMode(mode: TerminalMode): ModeState {
    return ensureTerm().getMode(mode)
  }

  function getTitle(): string {
    return ensureTerm().getTitle()
  }

  function getScrollback(): ScrollbackState {
    const [relativeOffset, totalLines, screenLines] = ensureTerm().getScrollback()
    const viewportTop = totalLines - screenLines - relativeOffset
    return {
      viewportTop,
      totalRows: totalLines,
      screenRows: screenLines,
      viewportOffset: viewportTop,
      totalLines,
      screenLines,
    }
  }

  function scrollViewport(delta: number): void {
    ensureTerm().scrollViewport(delta)
  }

  /** The five DEC modes the shared encoder state is built from, in query order. */
  const MOUSE_MODES = [1000, 1002, 1003, 1005, 1006] as const

  /**
   * Ask the engine which mouse modes it holds. The query goes to the native terminal directly,
   * never through `feed`, so the engine own replies cannot leak into `onResponse`. The five
   * anchored replies are matched exactly, in query order; anything else is reported with the
   * bytes that arrived, never resolved by an invented precedence.
   */
  function encodeMouse(event: MouseEvent): Uint8Array | null {
    const t = ensureTerm()
    t.feed(Buffer.from(MOUSE_MODES.map((mode) => `\u001b[?${mode}$p`).join(""), "latin1"))
    const response = t.readResponse()
    const bytes = response ? response.toString("latin1") : ""
    const answers = new RegExp(`^${MOUSE_MODES.map((mode) => `\\u001b\\[\\?${mode};([12])\\$y`).join("")}$`).exec(bytes)
    if (!answers) throw new Error(`mouse encoding unavailable: ${JSON.stringify(bytes)}`)
    const set = answers.slice(1).map((value) => value === "1")
    const trackings = MOUSE_MODES.slice(0, 3).filter((_, index) => set[index])
    const encodings = [1005, 1006].filter((_, index) => set[3 + index])
    if (trackings.length > 1) {
      throw new Error(`mouse encoding unavailable: tracking modes ${trackings.join("+")} all set`)
    }
    if (encodings.length > 1) {
      throw new Error(`mouse encoding unavailable: encoding modes ${encodings.join("+")} all set`)
    }
    const state: MouseEncodingState = {
      tracking: (trackings[0] ?? 0) as MouseEncodingState["tracking"],
      encoding: encodings[0] === 1005 ? "utf8" : encodings[0] === 1006 ? "sgr" : "legacy",
    }
    return encodeMouseReport(event, state)
  }

  const capabilities: TerminalCapabilities = {
    name: "alacritty",
    version: "0.26.0",
    truecolor: true,
    kittyKeyboard: true, // alacritty_terminal supports kitty keyboard protocol
    kittyGraphics: false,
    sixel: false,
    osc8Hyperlinks: true,
    semanticPrompts: false,
    unicode: "15.1",
    reflow: true,
    extensions: new Set(["adapter-sources", "reply-delivery", "hyperlinks", "mouse-encoding"]),
  }

  const backend: TerminalBackend &
    ReplyDeliveryExtension &
    HyperlinkExtension &
    AdapterSourcesExtension &
    MouseEncodingExtension = {
    getAdapterSources: () => adapterDeclaration.sources,
    name: "alacritty",
    init,
    destroy,
    feed,
    resize,
    reset,
    getText,
    getTextRange,
    getCell,
    getHyperlinkAt: (row, col) => getCell(row, col).hyperlink,
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
    encodeMouse,
    capabilities,
    replyDelivery,
  }

  return backend
}
