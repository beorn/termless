/**
 * TypeScript bindings for libvterm WASM module.
 *
 * Wraps the Emscripten-compiled libvterm C library with a clean API.
 * The WASM module must be loaded asynchronously before use.
 */

export interface LibvtermModule {
  // Memory management
  _malloc(size: number): number
  _free(ptr: number): void

  // libvterm functions (cwrap'd)
  vterm_new(rows: number, cols: number): number
  vterm_free(vt: number): void
  vterm_set_size(vt: number, rows: number, cols: number): void
  vterm_input_write(vt: number, bytes: number, len: number): number
  vterm_obtain_screen(vt: number): number
  vterm_obtain_state(vt: number): number
  vterm_screen_reset(screen: number, hard: number): void
  vterm_screen_enable_altscreen(screen: number, enable: number): void
  vterm_screen_get_cell(screen: number, row: number, col: number, cellPtr: number): number
  vterm_screen_get_text(
    screen: number,
    buf: number,
    bufLen: number,
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): number
  vterm_state_get_cursorpos(state: number, posPtr: number): void

  // Emscripten runtime
  getValue(ptr: number, type: string): number
  setValue(ptr: number, value: number, type: string): void
  UTF8ToString(ptr: number): string
  stringToUTF8(str: string, outPtr: number, maxBytesToWrite: number): void
  lengthBytesUTF8(str: string): number
  HEAPU8: Uint8Array
}

let modulePromise: Promise<LibvtermModule> | null = null
let loadedModule: LibvtermModule | null = null

/**
 * Load the libvterm WASM module. Must be called before creating backends.
 * Memoized -- safe to call multiple times.
 */
export async function initLibvterm(): Promise<LibvtermModule> {
  if (loadedModule) return loadedModule
  if (modulePromise) return modulePromise

  modulePromise = (async () => {
    // Dynamic import of the Emscripten-generated JS loader
    const { default: createModule } = await import("../wasm/libvterm.js")
    const module = (await createModule()) as LibvtermModule

    // Wrap C functions with cwrap for easier calling
    const cwrap = (module as any).cwrap
    module.vterm_new = cwrap("vterm_new", "number", ["number", "number"])
    module.vterm_free = cwrap("vterm_free", null, ["number"])
    module.vterm_set_size = cwrap("vterm_set_size", null, ["number", "number", "number"])
    module.vterm_input_write = cwrap("vterm_input_write", "number", ["number", "number", "number"])
    module.vterm_obtain_screen = cwrap("vterm_obtain_screen", "number", ["number"])
    module.vterm_obtain_state = cwrap("vterm_obtain_state", "number", ["number"])
    module.vterm_screen_reset = cwrap("vterm_screen_reset", null, ["number", "number"])
    module.vterm_screen_enable_altscreen = cwrap("vterm_screen_enable_altscreen", null, ["number", "number"])
    module.vterm_screen_get_cell = cwrap("vterm_screen_get_cell", "number", ["number", "number", "number", "number"])
    module.vterm_screen_get_text = cwrap("vterm_screen_get_text", "number", [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ])
    module.vterm_state_get_cursorpos = cwrap("vterm_state_get_cursorpos", null, ["number", "number"])

    loadedModule = module
    return module
  })()

  return modulePromise
}

/** Get the loaded module, or null if not yet loaded. */
export function getLoadedModule(): LibvtermModule | null {
  return loadedModule
}

/** Reset shared module for testing. */
export function _resetLibvtermForTesting(): void {
  loadedModule = null
  modulePromise = null
}

/**
 * VTermScreenCell struct layout (from libvterm's vterm.h):
 * - chars[VTERM_MAX_CHARS_PER_CELL] (uint32_t[6]) = 24 bytes at offset 0
 * - char width (char) = 1 byte at offset 24
 * - attrs (bitfield struct) = ~4 bytes at offset 25-28
 *   - bold, underline, italic, blink, reverse, conceal, strike, font(4), dwl, dhl, small, baseline(2)
 * - fg (VTermColor) = 4 bytes at offset 32 (type + rgb.r/g/b)
 * - bg (VTermColor) = 4 bytes at offset 36
 *
 * NOTE: These offsets are approximate and may vary by platform/alignment.
 * They need to be verified against the actual compiled WASM output.
 * The CELL_SIZE should be large enough to hold a VTermScreenCell struct.
 */
export const CELL_SIZE = 64 // Conservative -- actual struct is ~44 bytes

/**
 * Read a VTermScreenCell from WASM memory at the given pointer.
 *
 * NOTE: The struct field offsets used here are based on the libvterm C header
 * and may need adjustment after verifying against the actual compiled WASM.
 */
export function readCell(
  mod: LibvtermModule,
  cellPtr: number,
): {
  chars: string
  width: number
  bold: boolean
  underline: number
  italic: boolean
  blink: boolean
  reverse: boolean
  conceal: boolean
  strike: boolean
  fgType: number
  fgR: number
  fgG: number
  fgB: number
  bgType: number
  bgR: number
  bgG: number
  bgB: number
} {
  const heap = mod.HEAPU8

  // Read chars (uint32_t[6] -- we only need the first codepoint for most cells)
  const cp0 = mod.getValue(cellPtr, "i32")
  const chars = cp0 > 0 ? String.fromCodePoint(cp0) : ""

  // Read width (offset 24)
  const width = heap[cellPtr + 24]!

  // Read attrs bitfield (offset 25 -- packed bits)
  const attrByte = heap[cellPtr + 25]!
  const bold = !!(attrByte & 1)
  const underline = (attrByte >> 1) & 0x3
  const italic = !!((attrByte >> 3) & 1)
  const blink = !!((attrByte >> 4) & 1)
  const reverse = !!((attrByte >> 5) & 1)
  const conceal = !!((attrByte >> 6) & 1)
  const strike = !!((attrByte >> 7) & 1)

  // Read fg color (VTermColor at offset 32 -- type byte + r/g/b)
  const fgType = heap[cellPtr + 32]!
  const fgR = heap[cellPtr + 33]!
  const fgG = heap[cellPtr + 34]!
  const fgB = heap[cellPtr + 35]!

  // Read bg color (VTermColor at offset 36)
  const bgType = heap[cellPtr + 36]!
  const bgR = heap[cellPtr + 37]!
  const bgG = heap[cellPtr + 38]!
  const bgB = heap[cellPtr + 39]!

  return {
    chars,
    width,
    bold,
    underline,
    italic,
    blink,
    reverse,
    conceal,
    strike,
    fgType,
    fgR,
    fgG,
    fgB,
    bgType,
    bgR,
    bgG,
    bgB,
  }
}
