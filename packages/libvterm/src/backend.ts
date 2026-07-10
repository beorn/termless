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
  TerminalBackend,
  TerminalOptions,
  Cell,
  CursorState,
  TerminalMode,
  ScrollbackState,
  TerminalCapabilities,
  RGB,
} from "../../../src/terminal/types.ts"
import { encodeKeyToAnsi } from "../../../src/terminal/key-encoding.ts"

// ===============================================================
// Cell conversion
// ===============================================================

/**
 * Convert a libvterm cell (read from WASM memory) to the termless Cell type.
 *
 * NOTE: The struct offsets used in readCell are approximate and may need
 * verification against the actual compiled WASM output.
 */
function convertLibvtermCell(mod: LibvtermModule, screen: number, row: number, col: number, cellPtr: number): Cell {
  mod.vterm_screen_get_cell(screen, row, col, cellPtr)
  const raw = readCell(mod, cellPtr)

  // libvterm reports colors with a type byte:
  // 0 = default, 1 = indexed, 2 = RGB
  const fg: RGB | null = raw.fgType === 2 ? { r: raw.fgR, g: raw.fgG, b: raw.fgB } : null
  const bg: RGB | null = raw.bgType === 2 ? { r: raw.bgR, g: raw.bgG, b: raw.bgB } : null

  return {
    char: raw.chars,
    fg,
    bg,
    bold: raw.bold,
    dim: false, // libvterm doesn't expose dim/faint in its cell attrs
    italic: raw.italic,
    underline: raw.underline > 0 ? "single" : false,
    underlineColor: null,
    strikethrough: raw.strike,
    inverse: raw.reverse,
    blink: raw.blink,
    hidden: raw.conceal,
    wide: raw.width > 1,
    continuation: false,
    hyperlink: null,
  }
}

// ===============================================================
// Backend factory
// ===============================================================

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

// TextEncoder for converting strings to bytes for WASM memory
const encoder = new TextEncoder()

function writeBytes(mod: LibvtermModule, ptr: number, data: Uint8Array): void {
  for (let i = 0; i < data.length; i++) {
    mod.setValue(ptr + i, data[i]!, "i8")
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
export function createLibvtermBackend(opts?: Partial<TerminalOptions>, mod?: LibvtermModule): TerminalBackend {
  let vt: number = 0 // VTerm* pointer
  let screen: number = 0 // VTermScreen* pointer
  let state: number = 0 // VTermState* pointer
  let module: LibvtermModule | null = mod ?? getLoadedModule()
  let cols = opts?.cols ?? DEFAULT_COLS
  let rows = opts?.rows ?? DEFAULT_ROWS
  let title = ""

  // Reusable cell struct allocation (allocated once per backend instance)
  let cellPtr: number = 0

  function ensureInit(): LibvtermModule {
    if (!module || !vt) {
      throw new Error("libvterm backend not initialized -- call init() first")
    }
    return module
  }

  function init(options: TerminalOptions): void {
    // Clean up previous instance if re-initializing
    if (vt && module) {
      module.vterm_free(vt)
      if (cellPtr) module._free(cellPtr)
    }

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
    title = ""

    // Create the VTerm instance
    vt = module.vterm_new(rows, cols)
    if (!vt) throw new Error("vterm_new returned null")

    // Get screen and state handles
    screen = module.vterm_obtain_screen(vt)
    state = module.vterm_obtain_state(vt)

    // Enable the screen (required for get_cell to work)
    module.vterm_screen_reset(screen, 1)

    // Enable alt screen support
    module.vterm_screen_enable_altscreen(screen, 1)

    // Allocate reusable cell struct
    cellPtr = module._malloc(CELL_SIZE)
  }

  function destroy(): void {
    if (module && vt) {
      if (cellPtr) {
        module._free(cellPtr)
        cellPtr = 0
      }
      module.vterm_free(vt)
      vt = 0
      screen = 0
      state = 0
    }
  }

  /**
   * Standard cell metrics used for synthetic CSI 14t / 18t window-op
   * responses. The libvterm backend (neovim's libvterm via WASM) is a
   * pure cell-grid emulator — there's no native window-pixel concept,
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
    const m = ensureInit()

    // Allocate WASM memory for the input data
    const ptr = m._malloc(data.length)
    writeBytes(m, ptr, data)

    // Feed data to libvterm
    m.vterm_input_write(vt, ptr, data.length)

    // Free the temporary buffer
    m._free(ptr)

    // Drain DA1/DA2/DSR responses and forward to the terminal layer.
    // libvterm buffers output internally; vterm_output_read drains it.
    if (backend.onResponse && m.vterm_output_read) {
      const outBufLen = 1024
      const outBuf = m._malloc(outBufLen)
      const bytesRead = m.vterm_output_read(vt, outBuf, outBufLen)
      if (bytesRead > 0) {
        backend.onResponse(readBytes(m, outBuf, bytesRead))
      }
      m._free(outBuf)
    }

    // Synthesize CSI 14t / 18t window-op probe responses from our
    // tracked cell grid (libvterm has no window-pixel concept).
    if (backend.onResponse) {
      const text = new TextDecoder().decode(data)
      CSI_14t_RE.lastIndex = 0
      let mm: RegExpExecArray | null
      while ((mm = CSI_14t_RE.exec(text)) !== null) {
        const heightPx = rows * CELL_H_PX
        const widthPx = cols * CELL_W_PX
        backend.onResponse(new TextEncoder().encode(`\x1b[4;${heightPx};${widthPx}t`))
      }
      CSI_18t_RE.lastIndex = 0
      while ((mm = CSI_18t_RE.exec(text)) !== null) {
        backend.onResponse(new TextEncoder().encode(`\x1b[8;${rows};${cols}t`))
      }
    }
  }

  function resize(newCols: number, newRows: number): void {
    const m = ensureInit()
    m.vterm_set_size(vt, newRows, newCols)
    cols = newCols
    rows = newRows
  }

  function reset(): void {
    const m = ensureInit()
    // Feed RIS (Reset to Initial State) escape sequence
    const ris = encoder.encode("\x1bc")
    const ptr = m._malloc(ris.length)
    writeBytes(m, ptr, ris)
    m.vterm_input_write(vt, ptr, ris.length)
    m._free(ptr)
    title = ""
  }

  function getText(): string {
    const m = ensureInit()
    const lines: string[] = []

    // Read each screen row using vterm_screen_get_text
    const bufLen = cols * 4 + 1 // UTF-8 worst case + null terminator
    const buf = m._malloc(bufLen)

    for (let row = 0; row < rows; row++) {
      const len = m.vterm_screen_get_text(screen, buf, bufLen, row, 0, row + 1, cols)
      if (len > 0) {
        const line = m.UTF8ToString(buf)
        lines.push(line.replace(/\s+$/, ""))
      } else {
        lines.push("")
      }
    }

    m._free(buf)
    return lines.join("\n")
  }

  function getTextRange(startRow: number, startCol: number, endRow: number, endCol: number): string {
    const m = ensureInit()
    const parts: string[] = []
    const bufLen = cols * 4 + 1
    const buf = m._malloc(bufLen)

    for (let row = startRow; row <= endRow; row++) {
      const colStart = row === startRow ? startCol : 0
      const colEnd = row === endRow ? endCol : cols

      const len = m.vterm_screen_get_text(screen, buf, bufLen, row, colStart, row + 1, colEnd)
      if (len > 0) {
        const line = m.UTF8ToString(buf)
        parts.push(line.replace(/\s+$/, ""))
      } else {
        parts.push("")
      }
    }

    m._free(buf)
    return parts.join("\n")
  }

  function getCell(row: number, col: number): Cell {
    const m = ensureInit()
    if (row < 0 || row >= rows || col < 0 || col >= cols) {
      return emptyCell()
    }
    return convertLibvtermCell(m, screen, row, col, cellPtr)
  }

  function getLine(row: number): Cell[] {
    const m = ensureInit()
    if (row < 0 || row >= rows) {
      return Array.from({ length: cols }, () => emptyCell())
    }

    const cells: Cell[] = []
    for (let col = 0; col < cols; col++) {
      cells.push(convertLibvtermCell(m, screen, row, col, cellPtr))
    }
    return cells
  }

  function getLines(): Cell[][] {
    const result: Cell[][] = []
    for (let row = 0; row < rows; row++) {
      result.push(getLine(row))
    }
    return result
  }

  function getCursor(): CursorState {
    const m = ensureInit()

    // VTermPos is { int row; int col; } = 8 bytes
    const posPtr = m._malloc(8)
    m.vterm_state_get_cursorpos(state, posPtr)
    const cursorRow = m.getValue(posPtr, "i32")
    const cursorCol = m.getValue(posPtr + 4, "i32")
    m._free(posPtr)

    return {
      x: cursorCol,
      y: cursorRow,
      col: cursorCol,
      row: cursorRow,
      visible: true, // libvterm doesn't expose cursor visibility via this API
      style: "block", // libvterm doesn't expose cursor style via this API
    }
  }

  function getMode(_mode: TerminalMode): boolean {
    // libvterm's C API doesn't expose terminal modes directly through
    // simple function calls. A full implementation would require
    // setting up state callbacks to track mode changes.
    // For now, return sensible defaults.
    switch (_mode) {
      case "altScreen":
        return false // Would need callback tracking
      case "cursorVisible":
        return true
      case "bracketedPaste":
        return false
      case "applicationCursor":
        return false
      case "applicationKeypad":
        return false
      case "autoWrap":
        return true // Default on in most terminals
      case "mouseTracking":
        return false
      case "focusTracking":
        return false
      case "originMode":
        return false
      case "insertMode":
        return false
      case "reverseVideo":
        return false
    }
  }

  function getTitle(): string {
    return title
  }

  function getScrollback(): ScrollbackState {
    // libvterm doesn't maintain its own scrollback buffer --
    // scrollback is the responsibility of the embedding application.
    return {
      viewportOffset: 0,
      totalLines: rows,
      screenLines: rows,
      viewportTop: 0,
      totalRows: rows,
      screenRows: rows,
    }
  }

  function scrollViewport(_delta: number): void {
    // libvterm doesn't support viewport scrolling --
    // scrollback is managed by the embedding application.
  }

  const capabilities: TerminalCapabilities = {
    name: "libvterm",
    version: "0.3.0",
    truecolor: true,
    kittyKeyboard: false,
    kittyGraphics: false,
    sixel: false,
    osc8Hyperlinks: false,
    semanticPrompts: false,
    unicode: "15.1",
    reflow: false,
    extensions: new Set<string>(),
  }

  const backend: TerminalBackend = {
    name: "libvterm",
    init,
    destroy,
    feed,
    resize,
    reset,
    getText,
    getTextRange,
    getCell,
    getLine,
    getRow: getLine,
    getRows: getLines,
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

/** Create an empty cell with default values. */
function emptyCell(): Cell {
  return {
    char: "",
    fg: null,
    bg: null,
    bold: false,
    dim: false,
    italic: false,
    underline: false as const,
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
