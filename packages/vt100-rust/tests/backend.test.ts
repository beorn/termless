/**
 * @failure Rust vt100 bindings drop cell attributes, icon state, and clipboard callback observations.
 * @level l0
 * @consumer Termless Rust vt100 backend cell observations.
 * @testonly none
 */

import { describe, test, expect } from "vitest"
import { createVt100RustBackend, loadVt100RustNative } from "../src/backend.ts"

let nativeBuildError: string | null = null
try {
  loadVt100RustNative()
} catch (error) {
  nativeBuildError = error instanceof Error ? error.message : String(error)
}

describe.skipIf(nativeBuildError !== null)(
  `Rust vt100 backend attributes${nativeBuildError ? ` (unavailable: ${nativeBuildError})` : ""}`,
  () => {
    test("reports dim set and reset on distinct cells", () => {
      const backend = createVt100RustBackend()
      backend.init({ cols: 4, rows: 1 })
      try {
        backend.feed(new TextEncoder().encode("\x1b[2mA\x1b[22mB"))
        expect(backend.getCell(0, 0).dim).toBe(true)
        expect(backend.getCell(0, 1).dim).toBe(false)
      } finally {
        backend.destroy()
      }
    })

    test("preserves distinct native icon and title state through OSC 0, 1, 2 and reset", () => {
      const backend = createVt100RustBackend({ cols: 4, rows: 1 })
      const feed = (text: string): void => backend.feed(new TextEncoder().encode(text))
      try {
        expect(backend.getIconLabel?.()).toBe("")
        feed("\x1b]0;both\x07")
        expect(backend.getIconLabel?.()).toBe("both")
        expect(backend.getTitle()).toBe("both")
        feed("\x1b]1;icon-only\x1b\\")
        expect(backend.getIconLabel?.()).toBe("icon-only")
        expect(backend.getTitle()).toBe("both")
        feed("\x1b]2;title-only\x07")
        expect(backend.getIconLabel?.()).toBe("icon-only")
        expect(backend.getTitle()).toBe("title-only")
        backend.reset()
        expect(backend.getIconLabel?.()).toBe("")
        expect(backend.getTitle()).toBe("")
      } finally {
        backend.destroy()
      }
    })

    test.each([..."cpqs01234567", "", "cp"])("retains OSC 52 callback data for selector %j", (selector) => {
      const native = new (loadVt100RustNative().Vt100RustTerminal)(4, 1)
      const text = "terminfo-osc52-native-callback-31694-λ"
      const payload = Buffer.from(text).toString("base64")
      native.feed(Buffer.from(`\x1b]52;${selector};${payload}\x07`))
      expect(native.getClipboardState().writes).toEqual([{ selector, payload, text }])
      native.feed(Buffer.from(`\x1b]52;${selector};?\x1b\\`))
      expect(native.getClipboardState().pasteSelector).toBe(selector)
    })

    test("rejects selectors and payload characters the engine does not dispatch", () => {
      const native = new (loadVt100RustNative().Vt100RustTerminal)(4, 1)
      native.feed(Buffer.from("\x1b]52;x;dGVzdA==\x07\x1b]52;c;%%%\x07\x1b]52;x;?\x07"))
      expect(native.getClipboardState()).toEqual({ writes: [] })
    })

    test("retains the last write per selector and exposes malformed encoding without inventing text", () => {
      const native = new (loadVt100RustNative().Vt100RustTerminal)(4, 1)
      native.feed(Buffer.from("\x1b]52;c;Zmlyc3Q=\x07\x1b]52;p;cHJpbWFyeQ==\x07\x1b]52;c;c2Vjb25k\x07"))
      expect(native.getClipboardState().writes).toEqual([
        { selector: "c", payload: "c2Vjb25k", text: "second" },
        { selector: "p", payload: "cHJpbWFyeQ==", text: "primary" },
      ])
      // The crate checks the alphabet, not base64 padding or decoded UTF8 validity.
      for (const payload of ["=", "/w=="]) {
        native.feed(Buffer.from(`\x1b]52;c;${payload}\x07`))
        expect(native.getClipboardState().writes[0]).toEqual({
          selector: "c",
          payload,
          decodeError: expect.any(String),
        })
      }
    })

    test("keeps callback state private to each native terminal and clears it on reset", () => {
      const Native = loadVt100RustNative().Vt100RustTerminal
      const first = new Native(4, 1)
      const second = new Native(4, 1)
      first.feed(Buffer.from("\x1b]52;c;dGVzdA==\x07\x1b]52;c;?\x07"))
      expect(second.getClipboardState()).toEqual({ writes: [] })
      first.reset()
      expect(first.getClipboardState()).toEqual({ writes: [] })
    })

    test("does not author OSC 52 replies when the engine only dispatches paste callbacks", () => {
      const backend = createVt100RustBackend({ cols: 4, rows: 1 })
      const responses: string[] = []
      backend.onResponse = (bytes) => responses.push(new TextDecoder().decode(bytes))
      try {
        const encoded = btoa("terminfo-osc52-native-callback-31694")
        backend.feed(new TextEncoder().encode(`\x1b]52;c;${encoded}\x07`))
        backend.feed(new TextEncoder().encode("\x1b]52;c;?\x07"))
        expect(responses).toEqual([])
      } finally {
        backend.destroy()
      }
    })
  },
)
