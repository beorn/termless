/**
 * libvterm backend for termless.
 *
 * Wraps neovim's libvterm (compiled to WASM via Emscripten) to implement
 * the TerminalBackend interface -- the same VT parser used by neovim's
 * built-in terminal, but headless via WASM.
 *
 * The WASM module requires async loading before use. Two patterns:
 *
 * 1. Pre-load the shared instance (recommended):
 *    ```ts
 *    await initLibvterm()
 *    const backend = createLibvtermBackend()
 *    backend.init({ cols: 80, rows: 24 }) // sync -- WASM already loaded
 *    ```
 *
 * 2. Use the registry:
 *    ```ts
 *    const b = await backend("libvterm")
 *    ```
 *
 * Calling init() without loading WASM first throws a clear error.
 */

import { getLoadedModule, readCell, CELL_SIZE, type LibvtermModule } from "./wasm-bindings.ts"
import type {
  AdapterSourcesExtension,
  TerminalBackend,
  TerminalOptions,
  Cell,
  Cursor,
  ScrollbackState,
  TerminalCapabilities,
  Color,
  KeyDescriptor,
  KeyEncodingExtension,
  MouseEvent,
  MouseEncodingExtension,
  PasteEncodingExtension,
  OscMetadataExtension,
  ReplyDeliveryExtension,
} from "../../../src/terminal/types.ts"
import type { Mode } from "@termless/core/io"
import { isNamedKey } from "../../../src/terminal/key-mapping.ts"
import { adapterDeclaration, replyDelivery } from "./reply-delivery.ts"

// oxlint-disable-next-line typescript/no-deprecated -- The registered adapter still implements this lifecycle.
type LegacyBackend = TerminalBackend

// ===============================================================
// Cell conversion
// ===============================================================

const ANSI_COLORS: readonly Color[] = [
  { r: 0, g: 0, b: 0 },
  { r: 128, g: 0, b: 0 },
  { r: 0, g: 128, b: 0 },
  { r: 128, g: 128, b: 0 },
  { r: 0, g: 0, b: 128 },
  { r: 128, g: 0, b: 128 },
  { r: 0, g: 128, b: 128 },
  { r: 192, g: 192, b: 192 },
  { r: 128, g: 128, b: 128 },
  { r: 255, g: 0, b: 0 },
  { r: 0, g: 255, b: 0 },
  { r: 255, g: 255, b: 0 },
  { r: 0, g: 0, b: 255 },
  { r: 255, g: 0, b: 255 },
  { r: 0, g: 255, b: 255 },
  { r: 255, g: 255, b: 255 },
]

function indexedColor(index: number): Color {
  if (index < 16) {
    const color = ANSI_COLORS[index]
    if (!color) throw new Error(`Missing ANSI color ${index}`)
    return color
  }
  if (index < 232) {
    const n = index - 16
    const component = (v: number) => (v === 0 ? 0 : 55 + 40 * v)
    return { r: component(Math.floor(n / 36)), g: component(Math.floor(n / 6) % 6), b: component(n % 6) }
  }
  const gray = 8 + 10 * (index - 232)
  return { r: gray, g: gray, b: gray }
}

function cellColor(type: number, r: number, g: number, b: number, defaultFlag: number): Color | null {
  if (type & defaultFlag) return null
  return type & 1 ? indexedColor(r) : { r, g, b }
}

function underlineStyle(raw: number, row: number, col: number): Cell["underline"] {
  switch (raw) {
    case 0:
      return false
    case 1:
      return "single"
    case 2:
      return "double"
    case 3:
      return "curly"
    default:
      throw new Error(`Invalid libvterm underline code ${raw} at cell (${row}, ${col}), flat ABI word 3`)
  }
}

/** Convert a libvterm cell from the shim's fixed-width values. */
function convertLibvtermCell(mod: LibvtermModule, row: number, col: number, cellPtr: number): Cell {
  const raw = readCell(mod, cellPtr)

  // vterm.h: bit 0 selects indexed color; bits 1/2 mark default fg/bg.
  const fg = cellColor(raw.fgType, raw.fgR, raw.fgG, raw.fgB, 0x02)
  const bg = cellColor(raw.bgType, raw.bgR, raw.bgG, raw.bgB, 0x04)

  return {
    char: raw.chars,
    fg,
    bg,
    bold: raw.bold,
    dim: null, // This producer does not expose dim/faint in its cell attrs.
    italic: raw.italic,
    underline: underlineStyle(raw.underline, row, col),
    underlineColor: null,
    strikethrough: raw.strike,
    inverse: raw.reverse,
    blink: raw.blink,
    overline: null,
    hidden: raw.conceal,
    wide: raw.width > 1,
    continuation: raw.continuation,
    hyperlink: null,
  }
}

// ===============================================================
// Backend factory
// ===============================================================

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const DEFAULT_SCROLLBACK_LIMIT = 1000

function checkedScrollbackLimit(value: number): number {
  // The native callback limit is a signed WASM32 integer, so reject wrapping.
  if (!Number.isSafeInteger(value) || value < 0 || value > 0x7fffffff) {
    throw new Error("libvterm scrollbackLimit must be an integer between 0 and 2147483647")
  }
  return value
}

// TextEncoder for converting strings to bytes for WASM memory
const encoder = new TextEncoder()

// VTermKey values from the pinned libvterm 0.3.3 vterm_keycodes.h.
const NATIVE_KEYS: Readonly<Record<string, number>> = {
  Enter: 1,
  Tab: 2,
  Backspace: 3,
  Escape: 4,
  ArrowUp: 5,
  ArrowDown: 6,
  ArrowLeft: 7,
  ArrowRight: 8,
  Delete: 10,
  Home: 11,
  End: 12,
  PageUp: 13,
  PageDown: 14,
}

function writeBytes(mod: LibvtermModule, ptr: number, data: Uint8Array): void {
  for (let i = 0; i < data.length; i++) {
    const byte = data[i]
    if (byte === undefined) throw new Error(`Missing input byte ${i}`)
    mod.setValue(ptr + i, byte, "i8")
  }
}

function readBytes(mod: LibvtermModule, ptr: number, length: number): Uint8Array {
  const data = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    data[i] = mod.getValue(ptr + i, "i8") & 0xff
  }
  return data
}

/**
 * Create a libvterm backend for termless.
 *
 * Uses neovim's libvterm (compiled to WASM via Emscripten) for headless
 * terminal emulation. The WASM module must be loaded before calling init() --
 * either via `await initLibvterm()` (shared) or by passing a pre-loaded
 * module directly.
 *
 * @param opts - Optional initial terminal dimensions (applied at init())
 * @param mod - Optional pre-loaded LibvtermModule (for test isolation).
 *   Falls back to the shared instance from initLibvterm().
 */
export function createLibvtermBackend(
  opts?: Partial<TerminalOptions>,
  mod?: LibvtermModule,
): LegacyBackend &
  AdapterSourcesExtension &
  KeyEncodingExtension &
  MouseEncodingExtension &
  PasteEncodingExtension &
  OscMetadataExtension {
  const configuredLimit = checkedScrollbackLimit(opts?.scrollbackLimit ?? DEFAULT_SCROLLBACK_LIMIT)
  // Private VTerm*: callers cannot send raw paste boundaries into this backend's reply sink.
  let vt: number = 0
  let screen: number = 0 // VTermScreen* pointer
  let state: number = 0 // VTermState* pointer
  let output: number = 0 // TermlessOutputSink* holding replies until feed() drains them
  let module: LibvtermModule | null = mod ?? getLoadedModule()
  let cols = opts?.cols ?? DEFAULT_COLS
  let rows = opts?.rows ?? DEFAULT_ROWS

  // Reusable cell struct allocation (allocated once per backend instance)
  let cellPtr: number = 0
  // Observation record owned by this instance: visibility, native shape, blink, and VTERM_PROP_TITLE buffers.
  let cursorPropsPtr = 0

  function ensureInit(): LibvtermModule {
    if (!module || !vt) {
      throw new Error("libvterm backend not initialized -- call init() first")
    }
    if (cursorPropsPtr && module.getValue(cursorPropsPtr + 64, "i32")) {
      throw new Error("libvterm native observation failed after an allocation failure; history or properties were lost")
    }
    return module
  }

  function init(options: TerminalOptions): void {
    const historyLimit = checkedScrollbackLimit(options.scrollbackLimit ?? configuredLimit)
    // Clean up previous instance if re-initializing
    destroy()

    // Resolve the module -- prefer injected, then shared
    module = mod ?? getLoadedModule()
    if (!module) {
      throw new Error(
        "libvterm WASM not loaded -- call `await initLibvterm()` before init(), " +
          "or pass a pre-loaded LibvtermModule to createLibvtermBackend().",
      )
    }

    cols = options.cols
    rows = options.rows

    // Create the VTerm instance
    vt = module.vterm_new(rows, cols)
    if (!vt) throw new Error("vterm_new returned null")
    output = module.termless_vterm_output_attach(vt)
    if (!output) {
      destroy()
      throw new Error("libvterm output sink allocation failed")
    }

    // Get screen and state handles
    screen = module.vterm_obtain_screen(vt)
    state = module.vterm_obtain_state(vt)

    // C owns the full context; JS reads only its existing property prefix.
    cursorPropsPtr = module.termless_vterm_observer_new(state, historyLimit)
    if (!cursorPropsPtr) {
      destroy()
      throw new Error("libvterm cursor observation allocation failed")
    }
    module.termless_vterm_screen_observe_props(screen, cursorPropsPtr)
    module.termless_vterm_observer_enable_reflow(screen, cursorPropsPtr)

    // Enable the screen (required for get_cell to work)
    module.vterm_screen_reset(screen, 1)

    // Enable alt screen support
    module.vterm_screen_enable_altscreen(screen, 1)

    // Allocate reusable cell struct
    cellPtr = module._malloc(CELL_SIZE)
  }

  function destroy(): void {
    if (module && vt) {
      // A failed init can destroy before the screen handle exists; libvterm dereferences the screen it is given.
      if (screen) module.termless_vterm_screen_observe_props(screen, 0)
      if (cursorPropsPtr) {
        module.termless_vterm_observer_free(cursorPropsPtr)
        cursorPropsPtr = 0
      }
      if (cellPtr) {
        module._free(cellPtr)
        cellPtr = 0
      }
      if (output) {
        module.termless_vterm_output_detach(vt, output)
        output = 0
      }
      module.vterm_free(vt)
      vt = 0
      screen = 0
      state = 0
    }
  }

  function feed(data: Uint8Array): void {
    const m = ensureInit()

    // Allocate WASM memory for the input data
    const ptr = m._malloc(data.length)
    writeBytes(m, ptr, data)

    // Feed data to libvterm
    m.vterm_input_write(vt, ptr, data.length)

    // Free the temporary buffer
    m._free(ptr)

    if (m.getValue(cursorPropsPtr + 64, "i32")) {
      throw new Error("libvterm native observation failed after an allocation failure; history or properties were lost")
    }

    // Drain every reply this feed produced, in order, from the output sink (build/flat-api.c); replies nobody
    // listens for are discarded so the sink never grows across feeds.
    const outBufLen = 1024
    const outBuf = m._malloc(outBufLen)
    try {
      for (;;) {
        const bytesRead = m.termless_vterm_output_read(output, outBuf, outBufLen)
        if (bytesRead < 0) {
          throw new Error("libvterm callback buffer could not grow; response or selection data was lost")
        }
        if (bytesRead === 0) break
        backend.onResponse?.(readBytes(m, outBuf, bytesRead))
      }
    } finally {
      m._free(outBuf)
    }
  }

  function captureInput(action: (m: LibvtermModule) => void): Uint8Array {
    const m = ensureInit()
    const capture = m.termless_vterm_output_capture_begin(vt)
    if (!capture) throw new Error("libvterm input capture allocation failed")
    let outBuf = 0
    try {
      const outBufLen = 1024
      outBuf = m._malloc(outBufLen)
      if (!outBuf) throw new Error("libvterm input capture read allocation failed")
      action(m)
      const chunks: Uint8Array[] = []
      let length = 0
      for (;;) {
        const bytesRead = m.termless_vterm_output_read(capture, outBuf, outBufLen)
        if (bytesRead < 0) throw new Error("libvterm input capture buffer could not grow; input data was lost")
        if (bytesRead === 0) break
        chunks.push(readBytes(m, outBuf, bytesRead))
        length += bytesRead
      }
      const bytes = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.length
      }
      return bytes
    } finally {
      // Restore only the output callback: attach/detach also owns OSC 52 selection state.
      try {
        m.termless_vterm_output_capture_end(vt, output, capture)
      } finally {
        if (outBuf) m._free(outBuf)
      }
    }
  }

  function encodeKey(key: KeyDescriptor): Uint8Array {
    const unsupported = () => new Error(`libvterm keyboard API has no native encoding for ${JSON.stringify(key)}`)
    if (key.super) throw unsupported()
    const modifiers = (key.shift ? 1 : 0) | (key.alt ? 2 : 0) | (key.ctrl ? 4 : 0)
    if (isNamedKey(key.key)) {
      if (key.key === "Space") {
        return captureInput((m) => m.vterm_keyboard_unichar(vt, 32, modifiers))
      }
      const nativeKey = /^F(?:[1-9]|1[0-2])$/.test(key.key) ? 256 + Number(key.key.slice(1)) : NATIVE_KEYS[key.key]
      if (nativeKey === undefined) throw unsupported()
      return captureInput((m) => m.vterm_keyboard_key(vt, nativeKey, modifiers))
    }
    if (/^F\d+$/.test(key.key)) throw unsupported()
    const scalars = Array.from(key.key)
    if (scalars.length !== 1 && modifiers) throw unsupported()
    return captureInput((m) => {
      for (const scalar of scalars) {
        const codepoint = scalar.codePointAt(0)
        if (codepoint === undefined) throw unsupported()
        m.vterm_keyboard_unichar(vt, codepoint, modifiers)
      }
    })
  }

  function encodePaste(text: string): Uint8Array {
    return captureInput((m) => {
      let failed = false
      let primary: unknown
      try {
        m.vterm_keyboard_start_paste(vt)
        for (const scalar of text) {
          const codepoint = scalar.codePointAt(0)
          if (codepoint === undefined) throw new Error("libvterm paste text has no Unicode codepoint")
          m.vterm_keyboard_unichar(vt, codepoint, 0)
        }
      } catch (error) {
        failed = true
        primary = error
        throw error
      } finally {
        try {
          m.vterm_keyboard_end_paste(vt)
        } catch (cleanup) {
          if (failed) throw new AggregateError([primary, cleanup], "libvterm paste input and cleanup failed")
          throw cleanup
        }
      }
    })
  }

  function encodeMouse(event: MouseEvent): Uint8Array | null {
    if (event.pixel !== undefined) {
      throw new Error("libvterm mouse API has no native encoding for pixel coordinates")
    }
    const modifiers = (event.shift ? 1 : 0) | (event.alt ? 2 : 0) | (event.ctrl ? 4 : 0)
    const buttons = { left: 1, middle: 2, right: 3, wheelUp: 4, wheelDown: 5, none: 0 }
    const bytes = captureInput((m) => {
      m.vterm_mouse_move(vt, event.y, event.x, modifiers)
      if (event.action !== "move" && event.button !== "none") {
        m.vterm_mouse_button(vt, buttons[event.button], event.action === "press" ? 1 : 0, modifiers)
      }
    })
    return bytes.length ? bytes : null
  }

  function resize(newCols: number, newRows: number): void {
    const m = ensureInit()
    m.vterm_set_size(vt, newRows, newCols)
    cols = newCols
    rows = newRows
  }

  function reset(): void {
    const m = ensureInit()
    // Keep title/icon reset behavior without inventing an sb_clear callback.
    m.termless_vterm_screen_observe_props(0, cursorPropsPtr)
    // Feed RIS (Reset to Initial State) escape sequence
    const ris = encoder.encode("\x1bc")
    const ptr = m._malloc(ris.length)
    writeBytes(m, ptr, ris)
    m.vterm_input_write(vt, ptr, ris.length)
    m._free(ptr)
  }

  function getText(): string {
    const lines: string[] = []
    const total = getScrollback().totalRows
    for (let row = 0; row < total; row++) {
      lines.push(readRowText(row, 0, rowColumns(row)).replace(/\s+$/, ""))
    }
    return lines.join("\n")
  }

  function getTextRange(startRow: number, startCol: number, endRow: number, endCol: number): string {
    const parts: string[] = []
    for (let row = startRow; row <= endRow; row++) {
      const colStart = row === startRow ? startCol : 0
      const colEnd = row === endRow ? endCol : rowColumns(row)
      parts.push(readRowText(row, colStart, colEnd).replace(/\s+$/, ""))
    }
    return parts.join("\n")
  }

  function rowColumns(row: number): number {
    const m = ensureInit()
    const history = m.termless_vterm_history_count(cursorPropsPtr)
    if (row < 0 || row >= history + rows) return 0
    return row < history ? m.termless_vterm_history_cols(cursorPropsPtr, row) : cols
  }

  function readRowText(row: number, startCol: number, endCol: number): string {
    const m = ensureInit()
    const width = rowColumns(row)
    const start = Math.max(0, Math.min(startCol, width))
    const end = Math.max(start, Math.min(endCol, width))
    if (start === end) return ""
    const history = m.termless_vterm_history_count(cursorPropsPtr)
    const readText = (buf: number, length: number) =>
      row < history
        ? m.termless_vterm_history_get_text(cursorPropsPtr, row, start, end, buf, length)
        : m.vterm_screen_get_text(screen, buf, length, row - history, start, row - history + 1, end)
    // Both native readers support a sizing query. No combining text is hidden
    // behind a guessed UTF-8 buffer size, including old wider history rows.
    const byteLength = readText(0, 0)
    if (byteLength < 0) throw new Error(`libvterm could not size retained row ${row}`)
    if (byteLength === 0) return ""
    const buf = m._malloc(byteLength + 1)
    if (!buf) throw new Error("libvterm text read allocation failed")
    try {
      const len = readText(buf, byteLength)
      if (len !== byteLength) throw new Error(`libvterm retained row ${row} changed during read`)
      return m.UTF8ToString(buf, len)
    } finally {
      m._free(buf)
    }
  }

  function getCell(row: number, col: number): Cell {
    const m = ensureInit()
    if (col < 0 || col >= rowColumns(row)) {
      return emptyCell()
    }
    const history = m.termless_vterm_history_count(cursorPropsPtr)
    if (row >= history) {
      m.vterm_screen_get_cell(screen, row - history, col, cellPtr)
      return convertLibvtermCell(m, row, col, cellPtr)
    }
    if (!m.termless_vterm_history_get_cell_flat(cursorPropsPtr, row, col, cellPtr)) {
      throw new Error(`libvterm retained cell (${row}, ${col}) is unavailable`)
    }
    // Reuse the same normalized-cell conversion without re-reading a screen
    // coordinate. The native store retains all combining scalars for text.
    return {
      ...convertLibvtermCell(m, row, col, cellPtr),
      char: readRowText(row, col, col + 1),
    }
  }

  function getLine(row: number): Cell[] {
    const width = rowColumns(row)
    if (width === 0) {
      return Array.from({ length: cols }, () => emptyCell())
    }

    const cells: Cell[] = []
    for (let col = 0; col < width; col++) {
      cells.push(getCell(row, col))
    }
    return cells
  }

  function getLines(): Cell[][] {
    const result: Cell[][] = []
    const total = getScrollback().totalRows
    for (let row = 0; row < total; row++) {
      result.push(getLine(row))
    }
    return result
  }

  function getCursor(): Cursor {
    const m = ensureInit()

    // VTermPos is { int row; int col; } = 8 bytes
    const posPtr = m._malloc(8)
    m.vterm_state_get_cursorpos(state, posPtr)
    const cursorRow = m.getValue(posPtr, "i32")
    const cursorCol = m.getValue(posPtr + 4, "i32")
    m._free(posPtr)

    const visible = m.getValue(cursorPropsPtr, "i32")
    const shape = m.getValue(cursorPropsPtr + 4, "i32")

    return {
      // oxlint-disable-next-line typescript/no-deprecated -- Legacy cursor alias required by TerminalBackend.
      x: cursorCol,
      // oxlint-disable-next-line typescript/no-deprecated -- Legacy cursor alias required by TerminalBackend.
      y: cursorRow,
      col: cursorCol,
      row: cursorRow,
      visible: visible === -1 ? null : visible !== 0,
      // Native VTERM_PROP_CURSORSHAPE_{BLOCK,UNDERLINE,BAR_LEFT} = 1,2,3.
      style: shape === 1 ? "block" : shape === 2 ? "underline" : shape === 3 ? "beam" : null,
    }
  }

  function getMode(mode: Mode): boolean | null {
    if (mode === "applicationKeypad") {
      return ensureInit().termless_vterm_state_get_application_keypad(state) !== 0
    }
    if (mode === "applicationCursor") {
      return ensureInit().termless_vterm_state_get_application_cursor(state) !== 0
    }
    if (mode === "reverseVideo") {
      // Native VTERM_PROP_REVERSE observations survive reset exactly as the engine's mode does.
      const reverse = ensureInit().getValue(cursorPropsPtr + 36, "i32")
      return reverse === -1 ? null : reverse !== 0
    }
    return null
  }

  function getTitle(): string {
    const m = ensureInit()
    if (m.getValue(cursorPropsPtr + 64, "i32")) throw new Error("libvterm title observation failed")
    const len = m.termless_vterm_screen_get_title_len(cursorPropsPtr)
    if (len <= 0) return ""
    const ptr = m.termless_vterm_screen_get_title(cursorPropsPtr)
    return m.UTF8ToString(ptr, len)
  }

  function getIconLabel(): string {
    const m = ensureInit()
    if (m.getValue(cursorPropsPtr + 64, "i32")) throw new Error("libvterm icon observation failed")
    const len = m.termless_vterm_screen_get_icon_len(cursorPropsPtr)
    return len > 0 ? m.UTF8ToString(m.termless_vterm_screen_get_icon(cursorPropsPtr), len) : ""
  }

  function getCwd(): string | null {
    const m = ensureInit()
    const ptr = m.termless_vterm_screen_get_cwd(cursorPropsPtr)
    if (!ptr) return null
    const len = m.termless_vterm_screen_get_cwd_len(cursorPropsPtr)
    const bytes = new Uint8Array(len)
    for (let index = 0; index < len; index++) bytes[index] = m.getValue(ptr + index, "i8")
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
  }

  function getNotifications(): readonly string[] {
    const m = ensureInit()
    const count = m.termless_vterm_notification_count(cursorPropsPtr)
    return Array.from({ length: count }, (_, index) => {
      const len = m.termless_vterm_notification_len(cursorPropsPtr, index)
      return len ? m.UTF8ToString(m.termless_vterm_notification_get(cursorPropsPtr, index), len) : ""
    })
  }

  function getOsc777Payloads(): readonly string[] {
    const m = ensureInit()
    const count = m.termless_vterm_osc777_count(cursorPropsPtr)
    return Array.from({ length: count }, (_, index) => {
      const len = m.termless_vterm_osc777_len(cursorPropsPtr, index)
      return len ? m.UTF8ToString(m.termless_vterm_osc777_get(cursorPropsPtr, index), len) : ""
    })
  }

  function getUnhandledSequences(): readonly { readonly kind: "osc"; readonly code: string }[] {
    const m = ensureInit()
    if (m.getValue(cursorPropsPtr + 64, "i32")) throw new Error("libvterm OSC observation failed")
    const count = m.termless_vterm_unhandled_osc_count(cursorPropsPtr)
    return Array.from({ length: count }, (_, index) => ({
      kind: "osc",
      code: String(m.termless_vterm_unhandled_osc_get(cursorPropsPtr, index)),
    }))
  }

  function getScrollback(): ScrollbackState {
    const history = ensureInit().termless_vterm_history_count(cursorPropsPtr)
    return {
      // oxlint-disable-next-line typescript/no-deprecated -- Legacy scrollback alias required by TerminalBackend.
      viewportOffset: history,
      // oxlint-disable-next-line typescript/no-deprecated -- Legacy scrollback alias required by TerminalBackend.
      totalLines: history + rows,
      // oxlint-disable-next-line typescript/no-deprecated -- Legacy scrollback alias required by TerminalBackend.
      screenLines: rows,
      viewportTop: history,
      totalRows: history + rows,
      screenRows: rows,
    }
  }

  function scrollViewport(_delta: number): void {
    // libvterm doesn't support viewport scrolling --
    // scrollback is managed by the embedding application.
  }

  const capabilities: TerminalCapabilities = {
    name: "libvterm",
    version: "0.3.3",
    truecolor: true,
    kittyKeyboard: false,
    kittyGraphics: false,
    sixel: false,
    osc8Hyperlinks: false,
    semanticPrompts: false,
    unicode: "15.1",
    reflow: true,
    productViewport: {
      available: false,
      reason:
        "libvterm supplies history callbacks; this adapter retains rows for readback without an application viewport.",
    },
    extensions: new Set<string>([
      "adapter-sources",
      "reply-delivery",
      "key-encoding",
      "mouse-encoding",
      "paste-encoding",
      "osc-metadata",
    ]),
  }

  const backend: LegacyBackend &
    ReplyDeliveryExtension &
    AdapterSourcesExtension &
    KeyEncodingExtension &
    MouseEncodingExtension &
    PasteEncodingExtension &
    OscMetadataExtension = {
    getAdapterSources: () => adapterDeclaration.sources,
    name: "libvterm",
    init,
    destroy,
    feed,
    resize,
    reset,
    getText,
    getTextRange,
    getCell,
    // oxlint-disable-next-line typescript/no-deprecated -- Legacy method required by TerminalBackend.
    getLine,
    getRow: getLine,
    getRows: getLines,
    // oxlint-disable-next-line typescript/no-deprecated -- Legacy method required by TerminalBackend.
    getLines,
    getCursor,
    getMode,
    getTitle,
    getIconLabel,
    getCwd,
    getNotifications,
    getOsc777Payloads,
    getUnhandledSequences,
    getScrollback,
    getReflowState: () => ({ enabled: ensureInit().termless_vterm_observer_get_reflow(cursorPropsPtr) !== 0 }),
    scrollViewport,
    encodeKey,
    encodeMouse,
    encodePaste,
    capabilities,
    replyDelivery,
  }

  return backend
}

/** Create an empty cell with default values. */
function emptyCell(): Cell {
  return {
    char: "",
    fg: null,
    bg: null,
    bold: false,
    dim: null,
    italic: false,
    underline: false as const,
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
}
