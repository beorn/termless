/**
 * TypeScript bindings for libvterm WASM module.
 *
 * Wraps the Emscripten-compiled libvterm C library with a clean API.
 * The WASM module must be loaded asynchronously before use.
 */

import { createHash } from "node:crypto"
import { readFileSync, realpathSync } from "node:fs"

export interface LibvtermModule {
  // Memory management
  _malloc(size: number): number
  _free(ptr: number): void

  // libvterm functions (cwrap'd)
  /** Creates the adapter's UTF-8 terminal, rather than libvterm's byte-mode default. */
  vterm_new(rows: number, cols: number): number
  vterm_free(vt: number): void
  vterm_set_size(vt: number, rows: number, cols: number): void
  vterm_input_write(vt: number, bytes: number, len: number): number
  vterm_output_read?: (vt: number, buf: number, len: number) => number
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
  UTF8ToString(ptr: number, maxBytesToRead?: number): string
  stringToUTF8(str: string, outPtr: number, maxBytesToWrite: number): void
  lengthBytesUTF8(str: string): number
}

let modulePromise: Promise<LibvtermModule> | null = null
let loadedModule: LibvtermModule | null = null
let loadedWasm: { path: string; sha256: string } | null = null

/** Internal measurement of the exact file supplied to Emscripten. */
export function loadedLibvtermWasm(): { path: string; sha256: string } {
  if (!loadedModule || !loadedWasm) throw new Error("libvterm WASM has not loaded")
  return loadedWasm
}

/**
 * Load the libvterm WASM module. Must be called before creating backends.
 * Memoized -- safe to call multiple times.
 */
export async function initLibvterm(): Promise<LibvtermModule> {
  if (loadedModule) return loadedModule
  if (modulePromise) return modulePromise

  modulePromise = (async () => {
    // Dynamic import of the Emscripten-generated JS loader
    const generated: unknown = await import("../wasm/libvterm.js")
    if (
      typeof generated !== "object" ||
      generated === null ||
      !("default" in generated) ||
      typeof generated.default !== "function"
    ) {
      throw new Error("Generated libvterm loader does not export a module factory")
    }
    const createModule = generated.default as (options: { locateFile(name: string): string }) => Promise<unknown>
    const path = realpathSync(new URL("../wasm/libvterm.wasm", import.meta.url))
    const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex")
    let located = false
    const loaded: unknown = await createModule({
      locateFile(name: string) {
        if (name !== "libvterm.wasm") throw new Error(`Unexpected libvterm asset ${name}`)
        located = true
        return path
      },
    })
    if (typeof loaded !== "object" || loaded === null || !("cwrap" in loaded) || typeof loaded.cwrap !== "function") {
      throw new Error("Generated libvterm module does not expose cwrap")
    }
    const module = loaded as LibvtermModule & {
      cwrap(name: string, returnType: "number" | null, argumentTypes: string[]): (...args: number[]) => number
    }
    if (!located) throw new Error("libvterm did not request the pinned WASM file")
    if (createHash("sha256").update(readFileSync(path)).digest("hex") !== sha256) {
      throw new Error(`libvterm WASM changed while loading: ${path}`)
    }

    // Wrap C functions with cwrap for easier calling
    const cwrap = module.cwrap.bind(module)
    module.vterm_new = cwrap("termless_vterm_new_utf8", "number", ["number", "number"])
    module.vterm_free = cwrap("vterm_free", null, ["number"])
    module.vterm_set_size = cwrap("vterm_set_size", null, ["number", "number", "number"])
    module.vterm_input_write = cwrap("vterm_input_write", "number", ["number", "number", "number"])
    module.vterm_output_read = cwrap("vterm_output_read", "number", ["number", "number", "number"])
    module.vterm_obtain_screen = cwrap("vterm_obtain_screen", "number", ["number"])
    module.vterm_obtain_state = cwrap("vterm_obtain_state", "number", ["number"])
    module.vterm_screen_reset = cwrap("vterm_screen_reset", null, ["number", "number"])
    module.vterm_screen_enable_altscreen = cwrap("vterm_screen_enable_altscreen", null, ["number", "number"])
    module.vterm_screen_get_cell = cwrap("termless_vterm_screen_get_cell_flat", "number", [
      "number",
      "number",
      "number",
      "number",
    ])
    module.vterm_screen_get_text = cwrap("termless_vterm_screen_get_text_flat", "number", [
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
    loadedWasm = { path, sha256 }
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

/** 17 uint32_t fields written by build/flat-api.c, independent of C struct layout. */
export const CELL_SIZE = 17 * 4

/** Read the fixed-width cell values emitted by the C shim. */
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
  const wordAt = (index: number) => mod.getValue(cellPtr + index * 4, "i32") >>> 0
  const cp0 = wordAt(0)
  const chars = cp0 > 0 ? String.fromCodePoint(cp0) : ""

  return {
    chars,
    width: wordAt(1),
    bold: !!wordAt(2),
    underline: wordAt(3),
    italic: !!wordAt(4),
    blink: !!wordAt(5),
    reverse: !!wordAt(6),
    conceal: !!wordAt(7),
    strike: !!wordAt(8),
    fgType: wordAt(9),
    fgR: wordAt(10),
    fgG: wordAt(11),
    fgB: wordAt(12),
    bgType: wordAt(13),
    bgR: wordAt(14),
    bgG: wordAt(15),
    bgB: wordAt(16),
  }
}
