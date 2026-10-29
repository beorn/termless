/**
 * @failure Rust vt100 bindings drop cell attributes, icon state, and clipboard callback observations.
 *   Retained native history is also hidden or read at viewport-relative rather than buffer rows.
 * @level l0
 * @consumer Termless Rust vt100 backend cell observations.
 * @testonly none
 */

import { describe, test, expect } from "vitest"
import { createVt100RustBackend, loadVt100RustNative } from "../src/backend.ts"
import { createTerminal } from "../../../src/terminal/terminal.ts"

const numberedLines = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `line-${String(index).padStart(2, "0")}`)
const rowText = (cells: readonly { char: string }[]): string =>
  cells
    .map((cell) => cell.char)
    .join("")
    .trimEnd()

let nativeBuildError: string | null = null
try {
  loadVt100RustNative()
} catch (error) {
  nativeBuildError = error instanceof Error ? error.message : String(error)
}

describe.skipIf(nativeBuildError !== null)(
  `Rust vt100 backend attributes${nativeBuildError ? ` (unavailable: ${nativeBuildError})` : ""}`,
  () => {
    // The old attribute-only fixtures never overflowed a screen. Real native history, rather than
    // a second JS history buffer, must supply the existing absolute-buffer read contract.
    test("native retained history reports its count independently of the current viewport offset", () => {
      const native = new (loadVt100RustNative().Vt100RustTerminal)(20, 4, 40)
      const lines = numberedLines(12)
      native.feed(Buffer.from(lines.join("\r\n")))
      expect(native.getText()).toContain("line-11")
      expect(native.getScrollback()).toEqual({ viewportOffset: 8, totalLines: 12, screenLines: 4 })
      expect(native.getText().split("\n")).toEqual(lines)
      expect(native.getTextRange(0, 0, 0, 7)).toBe("line-00")
      expect(native.getCell(0, 6).text).toBe("0")
      expect(
        native
          .getLine(0)
          .map((cell) => cell.text)
          .join("")
          .trimEnd(),
      ).toBe("line-00")
      native.scrollViewport(-3)
      expect(native.getScrollback()).toEqual({ viewportOffset: 5, totalLines: 12, screenLines: 4 })
      expect(native.getText().split("\n")).toEqual(lines)
      expect(native.getScrollback().viewportOffset).toBe(5)
    })

    test("all backend text, cell and row readers agree on absolute retained-history coordinates", () => {
      const backend = createVt100RustBackend({ cols: 20, rows: 4, scrollbackLimit: 40 })
      const lines = numberedLines(12)
      try {
        backend.feed(Buffer.from(lines.join("\r\n")))
        expect(backend.getText()).toContain("line-11")
        expect(backend.getScrollback()).toMatchObject({ viewportTop: 8, totalRows: 12, screenRows: 4 })
        expect(backend.getText().split("\n")).toEqual(lines)
        expect(backend.getTextRange(0, 0, 11, 7).split("\n")).toEqual(lines)
        expect(backend.getLines().map(rowText)).toEqual(lines)
        expect(backend.getRows().map(rowText)).toEqual(lines)
        for (const row of [0, 3, 8, 11]) {
          expect(rowText(backend.getLine(row))).toBe(lines[row])
          expect(rowText(backend.getRow(row))).toBe(lines[row])
          expect(backend.getCell(row, 6).char).toBe(lines[row]![6])
          expect(backend.getTextRange(row, 5, row, 7)).toBe(lines[row]!.slice(5))
        }
      } finally {
        backend.destroy()
      }
    })

    test("signed viewport movement changes the product view, clamps, and returns to the live bottom", () => {
      const term = createTerminal({ backend: createVt100RustBackend(), cols: 20, rows: 4, scrollbackLimit: 40 })
      const lines = numberedLines(12)
      try {
        term.feed(lines.join("\r\n"))
        expect(term.screen.getText()).toContain("line-11")
        expect(term.viewport.getLines()).toEqual(lines.slice(8))
        term.backend.scrollViewport(-3)
        expect(term.backend.getScrollback()).toMatchObject({ viewportTop: 5, totalRows: 12 })
        expect(term.viewport.getLines()).toEqual(lines.slice(5, 9))
        expect(term.screen.getLines()).toEqual(lines.slice(8))
        term.backend.scrollViewport(2)
        expect(term.viewport.getLines()).toEqual(lines.slice(7, 11))
        term.backend.scrollViewport(-100)
        expect(term.backend.getScrollback().viewportTop).toBe(0)
        expect(term.viewport.getLines()).toEqual(lines.slice(0, 4))
        term.backend.scrollViewport(100)
        expect(term.backend.getScrollback().viewportTop).toBe(8)
        expect(term.viewport.getLines()).toEqual(lines.slice(8))
      } finally {
        term.close()
      }
    })

    test("the scrollback getter and every absolute reader preserve an already scrolled product view", () => {
      const term = createTerminal({ backend: createVt100RustBackend(), cols: 20, rows: 4, scrollbackLimit: 40 })
      const lines = numberedLines(12)
      try {
        term.feed(lines.join("\r\n"))
        expect(term.screen.getText()).toContain("line-11")
        const backend = term.backend
        backend.scrollViewport(-5)
        const reads = [
          () => expect(backend.getScrollback()).toMatchObject({ viewportTop: 3, totalRows: 12 }),
          () => expect(backend.getText().split("\n")).toEqual(lines),
          () => expect(backend.getTextRange(0, 0, 11, 7).split("\n")).toEqual(lines),
          () => expect(backend.getCell(0, 6).char).toBe("0"),
          () => expect(rowText(backend.getLine(0))).toBe("line-00"),
          () => expect(rowText(backend.getRow(11))).toBe("line-11"),
          () => expect(backend.getLines().map(rowText)).toEqual(lines),
          () => expect(backend.getRows().map(rowText)).toEqual(lines),
        ]
        for (const read of reads) {
          read()
          expect(backend.getScrollback().viewportTop).toBe(3)
          expect(term.viewport.getLines()).toEqual(lines.slice(3, 7))
        }
      } finally {
        term.close()
      }
    })

    test("zero history capacity retains only the live screen and clamps both scroll directions", () => {
      const backend = createVt100RustBackend({ cols: 20, rows: 4, scrollbackLimit: 0 })
      const lines = numberedLines(12)
      try {
        backend.feed(Buffer.from(lines.join("\r\n")))
        expect(backend.getText()).toContain("line-11")
        expect(backend.getText().split("\n")).toEqual(lines.slice(8))
        for (const delta of [-20, 20]) {
          backend.scrollViewport(delta)
          expect(backend.getScrollback()).toMatchObject({ viewportTop: 0, totalRows: 4, screenRows: 4 })
          expect(rowText(backend.getRow(0))).toBe("line-08")
        }
      } finally {
        backend.destroy()
      }
    })

    test("history capacity evicts oldest native rows and rebases absolute buffer readers", () => {
      const backend = createVt100RustBackend({ cols: 20, rows: 4, scrollbackLimit: 5 })
      const lines = numberedLines(12)
      try {
        backend.feed(Buffer.from(lines.join("\r\n")))
        expect(backend.getText()).toContain("line-11")
        expect(backend.getScrollback()).toMatchObject({ viewportTop: 5, totalRows: 9, screenRows: 4 })
        expect(backend.getText().split("\n")).toEqual(lines.slice(3))
        expect(backend.getRows().map(rowText)).toEqual(lines.slice(3))
        expect(backend.getTextRange(0, 0, 0, 7)).toBe("line-03")
        expect(backend.getCell(0, 6).char).toBe("3")
        backend.scrollViewport(-100)
        expect(backend.getScrollback().viewportTop).toBe(0)
        expect(rowText(backend.getLine(0))).toBe("line-03")
      } finally {
        backend.destroy()
      }
    })

    test("alternate screen exposes only its own rows and restores retained primary history on exit", () => {
      const backend = createVt100RustBackend({ cols: 20, rows: 4, scrollbackLimit: 40 })
      const lines = numberedLines(12)
      try {
        backend.feed(Buffer.from(lines.join("\r\n")))
        expect(backend.getText()).toContain("line-11")
        backend.feed(Buffer.from("\x1b[?1049hALT"))
        expect(backend.getText()).toContain("ALT")
        expect(backend.getText()).not.toContain("line-")
        expect(backend.getScrollback()).toMatchObject({ viewportTop: 0, totalRows: 4, screenRows: 4 })
        backend.scrollViewport(-100)
        expect(backend.getScrollback().viewportTop).toBe(0)
        expect(rowText(backend.getRow(0))).toBe("ALT")
        backend.feed(Buffer.from("\x1b[?1049l"))
        expect(backend.getText().split("\n")).toEqual(lines)
        expect(backend.getScrollback()).toMatchObject({ viewportTop: 8, totalRows: 12 })
      } finally {
        backend.destroy()
      }
    })

    test("resize updates reader extents without hiding retained history and reset clears history and viewport", () => {
      const backend = createVt100RustBackend({ cols: 20, rows: 4, scrollbackLimit: 40 })
      const lines = numberedLines(12)
      try {
        backend.feed(Buffer.from(lines.join("\r\n")))
        expect(backend.getText()).toContain("line-11")
        backend.scrollViewport(-3)
        backend.resize(24, 6)
        expect(backend.getText()).toContain("line-00")
        expect(backend.getText()).toContain("line-11")
        const state = backend.getScrollback()
        expect(state.screenRows).toBe(6)
        expect(state.viewportTop).toBeGreaterThanOrEqual(0)
        expect(state.viewportTop).toBeLessThanOrEqual(state.totalRows - 6)
        expect(backend.getRows()).toHaveLength(state.totalRows)
        expect(backend.getRows().every((row) => row.length === 24)).toBe(true)
        expect(backend.getRows().map(rowText)).toEqual(backend.getText().split("\n"))
        backend.reset()
        expect(backend.getScrollback()).toMatchObject({ viewportTop: 0, totalRows: 6, screenRows: 6 })
        expect(backend.getText().trim()).toBe("")
        expect(backend.getRows()).toHaveLength(6)
      } finally {
        backend.destroy()
      }
    })

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

describe.skipIf(nativeBuildError !== null)(
  nativeBuildError === null
    ? "backend exposes the engine clipboard callback"
    : `getClipboardState NOT MEASURED (${nativeBuildError})`,
  () => {
    test("holds the OSC 52 write on the backend object after feed", () => {
      const backend = createVt100RustBackend({ cols: 4, rows: 1 })
      const encoded = btoa("terminfo-osc52-witness")
      try {
        backend.feed(new TextEncoder().encode(`\x1b]52;c;${encoded}\x07`))
        expect(backend.getClipboardState?.().writes).toEqual([
          expect.objectContaining({ selector: "c", payload: encoded }),
        ])
      } finally {
        backend.destroy()
      }
    })
  },
)
