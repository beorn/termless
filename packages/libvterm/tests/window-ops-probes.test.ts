/**
 * Window-op probe responses — libvterm backend.
 *
 * neovim's libvterm (compiled to WASM via Emscripten) is a pure cell-grid
 * emulator with no native window pixel concept, so we synthesize CSI 14t
 * (text-area pixel size) and CSI 18t (text-area cell count) responses
 * from configured grid × cell metrics. silvery's `resolveMouseOption()`
 * uses both to enable SGR-Pixels (1016) mouse coordinate mode.
 *
 * Skipped when the WASM module isn't built locally — the intercept lives
 * in the JS wrapper and is independent of the WASM, but the backend
 * can't initialize without it.
 */

import { describe, test, expect } from "vitest"
import { createLibvtermBackend } from "../src/backend.ts"
import { initLibvterm, type LibvtermModule } from "../src/wasm-bindings.ts"
import type { TerminalBackend } from "../../../src/terminal/types.ts"

const CSI_4_TEXT_AREA_PIXELS_RE = /^\x1b\[4;(\d+);(\d+)t$/
const CSI_8_TEXT_AREA_CELLS_RE = /^\x1b\[8;(\d+);(\d+)t$/

// Probe WASM availability synchronously up-front so we can use describe.skip.
// initLibvterm() is async, so we kick it off and await before the suite.
// A "loaded" module can still be incomplete when the WASM artifact isn't built;
// verify the exported accessors required by the TypeScript wrapper before running.
let wasmModule: LibvtermModule | null = null
let skipReason = ""
try {
  const candidate = await initLibvterm()
  if (
    candidate &&
    typeof (candidate as { _malloc?: unknown })._malloc === "function" &&
    typeof (candidate as { setValue?: unknown }).setValue === "function" &&
    typeof (candidate as { getValue?: unknown }).getValue === "function"
  ) {
    wasmModule = candidate
  } else {
    skipReason = "WASM module loaded but missing required exports (likely not built)"
  }
} catch (e) {
  skipReason = e instanceof Error ? e.message.split("\n")[0]! : String(e)
}

const describeWasm = wasmModule ? describe : describe.skip

async function probeBackend(query: string): Promise<string[]> {
  const backend: TerminalBackend = createLibvtermBackend(undefined, wasmModule!)
  backend.init?.({ cols: 80, rows: 24 })
  const responses: string[] = []
  backend.onResponse = (b: Uint8Array): void => {
    responses.push(new TextDecoder().decode(b))
  }
  backend.feed(new TextEncoder().encode(query))
  await new Promise<void>((r) => setTimeout(r, 50))
  return responses
}

describeWasm(`window-op probe responses — libvterm backend${skipReason ? ` (skipped: ${skipReason})` : ""}`, () => {
  // AC2: unknown cursor properties must not become negative feature results.
  // Existing ABI tests cover cells and positions, not unavailable properties.
  // @failure Fixed cursor defaults misreport accepted hide/shape sequences.
  // @level l2
  // @consumer Terminfo cursor probes
  // @testonly none
  test("keeps unobserved cursor properties unknown while reading its position", () => {
    const backend = createLibvtermBackend(undefined, wasmModule!)
    backend.init({ cols: 8, rows: 2 })
    try {
      backend.feed(new TextEncoder().encode("\x1b[2;4H\x1b[?25l\x1b[6 q"))
      expect(backend.getCursor()).toMatchObject({ row: 1, col: 3, visible: null, style: null })
      backend.feed(new TextEncoder().encode("\x1b[?25h\x1b[2 q"))
      expect(backend.getCursor()).toMatchObject({ row: 1, col: 3, visible: null, style: null })
    } finally {
      backend.destroy()
    }
  })

  test("reads fed text and cells through the flat WASM ABI", () => {
    const backend = createLibvtermBackend(undefined, wasmModule!)
    backend.init({ cols: 8, rows: 2 })
    try {
      backend.feed(new TextEncoder().encode("A\x1b[1;3;4;38;2;12;34;56;48;2;78;90;123mB\x1b[0mCé世"))
      expect(backend.getText().split("\n")[0]).toBe("ABCé世")
      expect(backend.getCell(0, 0)).toMatchObject({ char: "A", fg: null, bg: null })
      expect(backend.getCell(0, 1)).toMatchObject({
        char: "B",
        bold: true,
        italic: true,
        underline: "single",
        fg: { r: 12, g: 34, b: 56 },
        bg: { r: 78, g: 90, b: 123 },
      })
      expect(backend.getCell(0, 2)).toMatchObject({ char: "C", fg: null, bg: null })
      // The backend accepts UTF-8 bytes; ASCII alone cannot detect libvterm
      // accidentally starting in its default legacy single-byte mode.
      expect(backend.getCell(0, 3)).toMatchObject({ char: "é", wide: false })
      expect(backend.getCell(0, 4)).toMatchObject({ char: "世", wide: true })
      expect(backend.getCell(0, 5)).toMatchObject({ char: "", wide: false, continuation: true })
      backend.feed(new TextEncoder().encode("\x1bcé世"))
      expect(backend.getText().split("\n")[0]).toBe("é世")
      expect(backend.getCell(0, 0)).toMatchObject({ char: "é", wide: false })
      expect(backend.getCell(0, 1)).toMatchObject({ char: "世", wide: true })
    } finally {
      backend.destroy()
    }
  })

  // AC2/C9: malformed ABI metadata must not be reported as a valid negative cell attribute.
  // The ABI's pinned underline enum only defines 0..3; existing coverage exercises valid code 1.
  // @failure Unknown libvterm underline ABI values silently become false
  // @level l2
  // @consumer TerminalBackend cell conversion
  // @testonly none
  test("rejects an invalid raw underline code with cell and ABI context", () => {
    const realModule = wasmModule!
    const mod = Object.create(realModule) as LibvtermModule
    const realGetValue = realModule.getValue.bind(realModule)
    let wordReads = 0
    let underlineCode = 0
    mod.getValue = (ptr, type) => {
      if (wordReads++ === 3) return underlineCode
      return realGetValue(ptr, type)
    }

    const backend = createLibvtermBackend(undefined, mod)
    backend.init({ cols: 8, rows: 2 })
    try {
      for (const [code, expected] of [
        [0, false],
        [1, "single"],
        [2, "double"],
        [3, "curly"],
      ] as const) {
        underlineCode = code
        wordReads = 0
        expect(backend.getCell(1, 2).underline, `raw underline code ${code}`).toBe(expected)
      }
      underlineCode = 99
      wordReads = 0
      expect(() => backend.getCell(1, 2)).toThrow(/underline code 99.*cell \(1, 2\).*word 3/i)
    } finally {
      backend.destroy()
    }
  })

  test("feeds bytes through exported accessors without requiring HEAPU8", async () => {
    const backend: TerminalBackend = createLibvtermBackend(undefined, wasmModule!)
    backend.init?.({ cols: 80, rows: 24 })
    expect(() => backend.feed(new TextEncoder().encode("ok"))).not.toThrow()
    backend.destroy()
  })

  test("answers CSI 14t with text-area pixel size (CSI 4;h;w t)", async () => {
    const responses = await probeBackend("\x1b[14t")
    const pixelResponse = responses.find((r) => CSI_4_TEXT_AREA_PIXELS_RE.test(r))
    expect(pixelResponse, `no CSI 4;h;w t response in ${JSON.stringify(responses)}`).toBeDefined()
    const m = CSI_4_TEXT_AREA_PIXELS_RE.exec(pixelResponse!)!
    const height = Number(m[1])
    const width = Number(m[2])
    expect(height).toBeGreaterThan(24)
    expect(width).toBeGreaterThan(80)
    expect(width % 80).toBe(0)
    expect(height % 24).toBe(0)
  })

  test("answers CSI 18t with text-area cell count (CSI 8;h;w t)", async () => {
    const responses = await probeBackend("\x1b[18t")
    const cellResponse = responses.find((r) => CSI_8_TEXT_AREA_CELLS_RE.test(r))
    expect(cellResponse, `no CSI 8;h;w t response in ${JSON.stringify(responses)}`).toBeDefined()
    const m = CSI_8_TEXT_AREA_CELLS_RE.exec(cellResponse!)!
    expect(Number(m[1])).toBe(24)
    expect(Number(m[2])).toBe(80)
  })
})
