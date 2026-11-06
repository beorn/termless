/**
 * TypeScript bindings for libvterm WASM module.
 *
 * Wraps the Emscripten-compiled libvterm C library with a clean API.
 * The WASM module must be loaded asynchronously before use.
 */

import { createHash } from "node:crypto"
import { readFileSync, realpathSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

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
  vterm_keyboard_unichar(vt: number, codepoint: number, modifiers: number): void
  vterm_keyboard_key(vt: number, key: number, modifiers: number): void
  vterm_keyboard_start_paste(vt: number): void
  vterm_keyboard_end_paste(vt: number): void
  vterm_mouse_move(vt: number, row: number, col: number, modifiers: number): void
  vterm_mouse_button(vt: number, button: number, pressed: number, modifiers: number): void
  /** Routes every engine reply into the flat API's growable sink instead of libvterm's fixed buffer; 0 on failure. */
  termless_vterm_output_attach(vt: number): number
  /** Moves up to len pending reply bytes, in order, into buf; -1 once the sink has lost a reply. */
  termless_vterm_output_read(sink: number, buf: number, len: number): number
  termless_vterm_output_detach(vt: number, sink: number): void
  /** Temporarily captures native input output without changing the selection owner; 0 on allocation failure. */
  termless_vterm_output_capture_begin(vt: number): number
  /** Restores the original reply callback before freeing the temporary input sink. */
  termless_vterm_output_capture_end(vt: number, reply: number, capture: number): void
  vterm_obtain_screen(vt: number): number
  vterm_obtain_state(vt: number): number
  vterm_screen_reset(screen: number, hard: number): void
  vterm_screen_enable_altscreen(screen: number, enable: number): void
  /** One flat C observer; a zero record detaches before its allocation is freed. */
  termless_vterm_screen_observe_props(screen: number, record: number): void
  termless_vterm_screen_get_title(record: number): number
  termless_vterm_screen_get_title_len(record: number): number
  termless_vterm_screen_get_icon(record: number): number
  termless_vterm_screen_get_icon_len(record: number): number
  termless_vterm_screen_get_cwd(record: number): number
  termless_vterm_screen_get_cwd_len(record: number): number
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
  termless_vterm_state_get_application_cursor(state: number): number

  termless_vterm_observer_new(state: number, limit: number): number
  termless_vterm_observer_free(record: number): void
  termless_vterm_observer_enable_reflow(screen: number, record: number): void
  termless_vterm_observer_get_reflow(record: number): number
  termless_vterm_history_count(record: number): number
  termless_vterm_notification_count(record: number): number
  termless_vterm_notification_get(record: number, index: number): number
  termless_vterm_notification_len(record: number, index: number): number
  termless_vterm_osc777_count(record: number): number
  termless_vterm_unhandled_count(record: number): number
  termless_vterm_unhandled_kind(record: number, index: number): "osc" | "csi" | "apc"
  termless_vterm_unhandled_code(record: number, index: number): string
  termless_vterm_osc777_get(record: number, index: number): number
  termless_vterm_osc777_len(record: number, index: number): number
  termless_vterm_history_cols(record: number, row: number): number
  termless_vterm_history_get_cell_flat(record: number, row: number, col: number, out: number): number
  termless_vterm_history_get_text(
    record: number,
    row: number,
    startCol: number,
    endCol: number,
    buf: number,
    bufLen: number,
  ): number
  termless_vterm_state_get_application_keypad(state: number): number
  termless_vterm_state_get_mouse_tracking(state: number): number

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
    // Dynamic import of the Emscripten-generated JS loader. The indirect specifier keeps a bundler / static analyser
    // from treating this gitignored build output as a hard dependency to resolve at build time; it still resolves
    // against this module's URL, so an unbuilt tree fails loudly at initLibvterm.
    // Joined at runtime: rolldown constant-folds a string constant back into the import, which then bypasses the
    // `neverBundle` rule for this path and fails the build of a clean tree with UNRESOLVED_IMPORT.
    const specifier = ["..", "wasm", "libvterm.js"].join("/")
    const generated: unknown = await import(specifier)
    if (
      typeof generated !== "object" ||
      generated === null ||
      !("default" in generated) ||
      typeof generated.default !== "function"
    ) {
      throw new Error("Generated libvterm loader does not export a module factory")
    }
    const createModule = generated.default as (options: { locateFile(name: string): string }) => Promise<unknown>
    // Both artifact paths are indirect for the same reason: they are gitignored Emscripten build outputs a bundler
    // cannot resolve from a clean tree. The .wasm path is still resolved against this module's URL.
    const path = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "../wasm/libvterm.wasm"))
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
      cwrap<R extends number | string = number>(
        name: string,
        returnType: R extends string ? "string" : "number" | null,
        argumentTypes: string[],
      ): (...args: number[]) => R
    }
    if (!located) throw new Error("libvterm did not request the pinned WASM file")
    if (
      !("_termless_vterm_state_get_application_cursor" in loaded) ||
      typeof loaded._termless_vterm_state_get_application_cursor !== "function"
    ) {
      throw new Error("Generated libvterm module is missing _termless_vterm_state_get_application_cursor; rebuild WASM")
    }
    for (const name of [
      "_vterm_keyboard_unichar",
      "_vterm_keyboard_key",
      "_vterm_keyboard_start_paste",
      "_vterm_keyboard_end_paste",
      "_vterm_mouse_move",
      "_vterm_mouse_button",
      "_termless_vterm_output_capture_begin",
      "_termless_vterm_output_capture_end",
      "_termless_vterm_observer_new",
      "_termless_vterm_observer_free",
      "_termless_vterm_observer_enable_reflow",
      "_termless_vterm_observer_get_reflow",
      "_termless_vterm_history_count",
      "_termless_vterm_screen_get_cwd",
      "_termless_vterm_screen_get_cwd_len",
      "_termless_vterm_notification_count",
      "_termless_vterm_notification_get",
      "_termless_vterm_notification_len",
      "_termless_vterm_osc777_count",
      "_termless_vterm_unhandled_count",
      "_termless_vterm_unhandled_kind",
      "_termless_vterm_unhandled_code",
      "_termless_vterm_osc777_get",
      "_termless_vterm_osc777_len",
      "_termless_vterm_history_cols",
      "_termless_vterm_history_get_cell_flat",
      "_termless_vterm_history_get_text",
      "_termless_vterm_state_get_application_keypad",
      "_termless_vterm_state_get_mouse_tracking",
    ]) {
      if (!(name in loaded) || typeof (loaded as Record<string, unknown>)[name] !== "function") {
        throw new Error(`Generated libvterm module is missing ${name}; rebuild WASM`)
      }
    }
    if (createHash("sha256").update(readFileSync(path)).digest("hex") !== sha256) {
      throw new Error(`libvterm WASM changed while loading: ${path}`)
    }

    // Wrap C functions with cwrap for easier calling
    const cwrap = module.cwrap.bind(module)
    module.vterm_new = cwrap("termless_vterm_new_utf8", "number", ["number", "number"])
    module.vterm_free = cwrap("vterm_free", null, ["number"])
    module.vterm_set_size = cwrap("vterm_set_size", null, ["number", "number", "number"])
    module.vterm_input_write = cwrap("vterm_input_write", "number", ["number", "number", "number"])
    module.vterm_keyboard_unichar = cwrap("vterm_keyboard_unichar", null, ["number", "number", "number"])
    module.vterm_keyboard_key = cwrap("vterm_keyboard_key", null, ["number", "number", "number"])
    module.vterm_keyboard_start_paste = cwrap("vterm_keyboard_start_paste", null, ["number"])
    module.vterm_keyboard_end_paste = cwrap("vterm_keyboard_end_paste", null, ["number"])
    module.vterm_mouse_move = cwrap("vterm_mouse_move", null, ["number", "number", "number", "number"])
    module.vterm_mouse_button = cwrap("vterm_mouse_button", null, ["number", "number", "number", "number"])
    module.termless_vterm_output_attach = cwrap("termless_vterm_output_attach", "number", ["number"])
    module.termless_vterm_output_read = cwrap("termless_vterm_output_read", "number", ["number", "number", "number"])
    module.termless_vterm_output_detach = cwrap("termless_vterm_output_detach", null, ["number", "number"])
    module.termless_vterm_output_capture_begin = cwrap("termless_vterm_output_capture_begin", "number", ["number"])
    module.termless_vterm_output_capture_end = cwrap("termless_vterm_output_capture_end", null, [
      "number",
      "number",
      "number",
    ])
    module.vterm_obtain_screen = cwrap("vterm_obtain_screen", "number", ["number"])
    module.vterm_obtain_state = cwrap("vterm_obtain_state", "number", ["number"])
    module.vterm_screen_reset = cwrap("vterm_screen_reset", null, ["number", "number"])
    module.vterm_screen_enable_altscreen = cwrap("vterm_screen_enable_altscreen", null, ["number", "number"])
    module.termless_vterm_screen_observe_props = cwrap("termless_vterm_screen_observe_props", null, [
      "number",
      "number",
    ])
    module.termless_vterm_screen_get_title = cwrap("termless_vterm_screen_get_title", "number", ["number"])
    module.termless_vterm_screen_get_title_len = cwrap("termless_vterm_screen_get_title_len", "number", ["number"])
    module.termless_vterm_screen_get_icon = cwrap("termless_vterm_screen_get_icon", "number", ["number"])
    module.termless_vterm_screen_get_icon_len = cwrap("termless_vterm_screen_get_icon_len", "number", ["number"])
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
    module.termless_vterm_state_get_application_cursor = cwrap(
      "termless_vterm_state_get_application_cursor",
      "number",
      ["number"],
    )

    module.termless_vterm_observer_new = cwrap("termless_vterm_observer_new", "number", ["number", "number"])
    module.termless_vterm_observer_free = cwrap("termless_vterm_observer_free", null, ["number"])
    module.termless_vterm_observer_enable_reflow = cwrap("termless_vterm_observer_enable_reflow", null, [
      "number",
      "number",
    ])
    module.termless_vterm_observer_get_reflow = cwrap("termless_vterm_observer_get_reflow", "number", ["number"])
    module.termless_vterm_history_count = cwrap("termless_vterm_history_count", "number", ["number"])
    module.termless_vterm_screen_get_cwd = cwrap("termless_vterm_screen_get_cwd", "number", ["number"])
    module.termless_vterm_screen_get_cwd_len = cwrap("termless_vterm_screen_get_cwd_len", "number", ["number"])
    module.termless_vterm_notification_count = cwrap("termless_vterm_notification_count", "number", ["number"])
    module.termless_vterm_notification_get = cwrap("termless_vterm_notification_get", "number", ["number", "number"])
    module.termless_vterm_notification_len = cwrap("termless_vterm_notification_len", "number", ["number", "number"])
    module.termless_vterm_osc777_count = cwrap("termless_vterm_osc777_count", "number", ["number"])
    module.termless_vterm_unhandled_count = cwrap("termless_vterm_unhandled_count", "number", ["number"])
    module.termless_vterm_unhandled_kind = cwrap<"osc" | "csi" | "apc">("termless_vterm_unhandled_kind", "string", [
      "number",
      "number",
    ])
    module.termless_vterm_unhandled_code = cwrap<string>("termless_vterm_unhandled_code", "string", [
      "number",
      "number",
    ])
    module.termless_vterm_osc777_get = cwrap("termless_vterm_osc777_get", "number", ["number", "number"])
    module.termless_vterm_osc777_len = cwrap("termless_vterm_osc777_len", "number", ["number", "number"])
    module.termless_vterm_history_cols = cwrap("termless_vterm_history_cols", "number", ["number", "number"])
    module.termless_vterm_history_get_cell_flat = cwrap("termless_vterm_history_get_cell_flat", "number", [
      "number",
      "number",
      "number",
      "number",
    ])
    module.termless_vterm_history_get_text = cwrap("termless_vterm_history_get_text", "number", [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ])
    module.termless_vterm_state_get_application_keypad = cwrap(
      "termless_vterm_state_get_application_keypad",
      "number",
      ["number"],
    )

    module.termless_vterm_state_get_mouse_tracking = cwrap("termless_vterm_state_get_mouse_tracking", "number", [
      "number",
    ])

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
  continuation: boolean
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
  // libvterm marks the trailing cell of a wide glyph with UINT32_MAX.
  // It is a cell marker, not a Unicode code point.
  const continuation = cp0 === 0xffffffff
  const chars = cp0 === 0 || continuation ? "" : String.fromCodePoint(cp0)

  return {
    chars,
    width: wordAt(1),
    continuation,
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
