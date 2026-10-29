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
import { initLibvterm, loadedLibvtermWasm, type LibvtermModule } from "../src/wasm-bindings.ts"
import { hasExtension, type ReplyDeliveryExtension, type TerminalBackend } from "../../../src/terminal/types.ts"

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
  // CTO c02b6619's retained counterexample (/hh/var/@dev4/30576/libvterm-capacity-numeric.log): libvterm's
  // default 4096-byte output buffer dropped every reply that no longer fit before the adapter drained.
  test("delivers all 2000 ordered CPR replies (15020 bytes) from one feed", () => {
    const backend = createLibvtermBackend(undefined, wasmModule!)
    backend.init({ cols: 80, rows: 24 })
    try {
      const responses: string[] = []
      backend.onResponse = (bytes) => responses.push(new TextDecoder().decode(bytes))
      const positions = Array.from({ length: 2000 }, (_, i) => [1 + (i % 24), 1 + (i % 80)] as const)
      const expected = positions.map(([row, col]) => `\x1b[${row};${col}R`).join("")
      expect(new TextEncoder().encode(expected).length).toBe(15020)
      backend.feed(new TextEncoder().encode(positions.map(([row, col]) => `\x1b[${row};${col}H\x1b[6n`).join("")))
      expect(responses.join("")).toBe(expected)
    } finally {
      backend.destroy()
    }
  })

  // Complete-drain acceptance: one feed must deliver all ordered engine replies.
  // Existing single-query probes never cross the adapter's 1024-byte read boundary.
  // CTO 2cfdb6e8: complete delivery is declared only after whole DA1/DECRQSS replies are measured. Expected bytes
  // follow libvterm 9d6d2112 state.c (DA, request_status_string) and pen.c vterm_state_getpen, behind a backlog
  // larger than libvterm's former 4096-byte output buffer.
  test("delivers whole DA1, DA2 and DECRQSS replies in order behind a 5600-byte reply backlog", () => {
    const backend = createLibvtermBackend(undefined, wasmModule!)
    backend.init({ cols: 80, rows: 24 })
    try {
      const responses: string[] = []
      backend.onResponse = (bytes) => responses.push(new TextDecoder().decode(bytes))
      const exchanges = [
        ["\x1b[c", "\x1b[?1;2c"],
        ["\x1b[>c", "\x1b[>0;100;0c"],
        ["\x1b[1;3;4;5;7;9;38;2;10;20;30;48;5;200m\x1bP$qm\x1b\\", "\x1bP1$r1;3;4;5;7;9;38:2:10:20:30;48:5:200m\x1b\\"],
        ["\x1b[3;20r\x1bP$qr\x1b\\", "\x1bP1$r3;20r\x1b\\"],
        ["\x1b[4 q\x1bP$q q\x1b\\", "\x1bP1$r4 q\x1b\\"],
        ['\x1bP$q"q\x1b\\', '\x1bP1$r2"q\x1b\\'],
        ["\x1bP$qz\x1b\\", "\x1bP0$r\x1b\\"],
        ["\x1b[c", "\x1b[?1;2c"],
      ] as const
      const backlog = "\x1b[24;80R".repeat(700)
      expect(backlog.length).toBe(5600)
      backend.feed(
        new TextEncoder().encode("\x1b[24;80H\x1b[6n".repeat(700) + exchanges.map(([query]) => query).join("")),
      )
      expect(responses.join("")).toBe(backlog + exchanges.map(([, reply]) => reply).join(""))
    } finally {
      backend.destroy()
    }
  })

  test("delivers more than 1024 bytes of ordered engine replies before feed returns", () => {
    const backend = createLibvtermBackend(undefined, wasmModule!)
    backend.init({ cols: 80, rows: 24 })
    try {
      const responses: string[] = []
      backend.onResponse = (bytes) => responses.push(new TextDecoder().decode(bytes))
      const positions = Array.from({ length: 180 }, (_, i) => [1 + (i % 24), 1 + (i % 80)] as const)
      const expected = positions.map(([row, col]) => `\x1b[${row};${col}R`).join("")
      expect(new TextEncoder().encode(expected).length).toBeGreaterThan(1024)
      backend.feed(new TextEncoder().encode(positions.map(([row, col]) => `\x1b[${row};${col}H\x1b[6n`).join("")))
      expect(responses.join("")).toBe(expected)
    } finally {
      backend.destroy()
    }
  })

  // CTO 2cfdb6e8: complete delivery is declared after full DA1/DECRQSS replies were measured above, and binds the WASM
  // this suite actually loaded; the declaration test alone reads only the receipt.
  test("declares complete reply delivery for the loaded WASM", () => {
    const backend = createLibvtermBackend(undefined, wasmModule!)
    backend.init({ cols: 80, rows: 24 })
    try {
      if (!hasExtension<ReplyDeliveryExtension>(backend, "reply-delivery")) {
        throw new Error("libvterm declares no reply delivery")
      }
      expect(backend.replyDelivery.engine).toEqual({ kind: "wasm", sha256: loadedLibvtermWasm().sha256 })
    } finally {
      backend.destroy()
    }
  })

  // Cursor observations must come from native state and survive instance lifecycles.
  // The former null assertions could not detect missing native property readback.
  // @failure Missing or shared cursor observation hides native visibility/shape transitions.
  // @level l2
  // @consumer Terminfo cursor probes
  // @testonly none
  test("observes native cursor properties across reset and isolated instance lifetimes", () => {
    const backend = createLibvtermBackend(undefined, wasmModule!)
    const isolated = createLibvtermBackend(undefined, wasmModule!)
    backend.init({ cols: 8, rows: 2 })
    isolated.init({ cols: 8, rows: 2 })
    const responses: string[] = []
    backend.onResponse = (data) => responses.push(new TextDecoder().decode(data))
    try {
      expect(backend.getCursor()).toMatchObject({ row: 0, col: 0, visible: true, style: "block" })
      backend.feed(new TextEncoder().encode("\x1b[2;4H\x1b[?25l\x1b[6 q"))
      expect(backend.getCursor()).toMatchObject({ row: 1, col: 3, visible: false, style: "beam" })
      expect(isolated.getCursor()).toMatchObject({ row: 0, col: 0, visible: true, style: "block" })
      // Native reports catch an observer that caches a property but vetoes its native store.
      backend.feed(new TextEncoder().encode("\x1bP$q q\x1b\\"))
      expect(responses.join("")).toBe("\x1bP1$r6 q\x1b\\")
      responses.length = 0
      backend.feed(new TextEncoder().encode("\x1b[?5h\x1b[?5$p"))
      expect(responses.join("")).toBe("\x1b[?5;1$y")
      backend.feed(new TextEncoder().encode("\x1b[?5l"))
      backend.feed(new TextEncoder().encode("\x1b[?25h\x1b[2 q"))
      expect(backend.getCursor()).toMatchObject({ row: 1, col: 3, visible: true, style: "block" })
      backend.feed(new TextEncoder().encode("\x1b[?25l\x1b[6 q"))
      backend.reset()
      expect(backend.getCursor()).toMatchObject({ row: 0, col: 0, visible: true, style: "block" })

      isolated.feed(new TextEncoder().encode("\x1b[?25l\x1b[6 q"))
      backend.destroy()
      backend.init({ cols: 8, rows: 2 })
      expect(backend.getCursor()).toMatchObject({ row: 0, col: 0, visible: true, style: "block" })
      expect(isolated.getCursor()).toMatchObject({ row: 0, col: 0, visible: false, style: "beam" })
      isolated.reset()
      expect(isolated.getCursor()).toMatchObject({ row: 0, col: 0, visible: true, style: "block" })
    } finally {
      backend.destroy()
      isolated.destroy()
    }
  })

  test("keeps unobserved modes unknown (null) instead of returning hard-coded defaults", () => {
    const backend = createLibvtermBackend(undefined, wasmModule!)
    backend.init({ cols: 8, rows: 2 })
    try {
      const responses: string[] = []
      backend.onResponse = (b) => responses.push(new TextDecoder().decode(b))
      backend.feed(new TextEncoder().encode("\x1b[?1h\x1b[?7l\x1b[?25l\x1b[?1004h\x1b[?1049h\x1b[?2004h\x1b[?2004$p"))
      for (const mode of [
        "altScreen",
        "cursorVisible",
        "bracketedPaste",
        "applicationCursor",
        "applicationKeypad",
        "autoWrap",
        "mouseTracking",
        "focusTracking",
        "originMode",
        "insertMode",
        "reverseVideo",
      ] as const) {
        expect(backend.getMode(mode), `expected null for unobserved mode ${mode}`).toBeNull()
      }
      expect(backend.getMode("sgrMouse" as never)).toBeNull()
      expect(responses.join("")).toBe("\x1b[?2004;1$y")
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
        dim: null, // The ABI does not expose faint; null is not measured false.
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

  test("does not synthesize constant CSI 14t or mirror CSI 18t responses when libvterm is silent", async () => {
    expect(await probeBackend("\x1b[14t")).toEqual([])
    expect(await probeBackend("\x1b[18t")).toEqual([])
  })
})
