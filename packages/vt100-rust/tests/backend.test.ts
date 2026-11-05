/**
 * @failure Rust vt100 bindings drop cell attributes, icon state, and clipboard callback observations.
 *   Retained native history is also hidden or read at viewport-relative rather than buffer rows.
 * @level l0
 * @consumer Termless Rust vt100 backend cell observations.
 * @testonly none
 */

import { describe, test, expect, expectTypeOf } from "vitest"
import { createVt100RustBackend, loadVt100RustNative } from "../src/backend.ts"
import { createTerminal } from "../../../src/terminal/terminal.ts"
import { hasExtension } from "../../../src/terminal/types.ts"
import type {
  MouseEncodingExtension,
  MouseEvent,
  OscMetadataExtension,
  TerminalBackend,
} from "../../../src/terminal/types.ts"

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
    // Neither conceal nor strikethrough has a getter in the pinned crate, including blank cells.
    test("cell and row readers retain unreported attributes separately from reported bold", () => {
      const backend = createVt100RustBackend({ cols: 5, rows: 2 })
      try {
        backend.feed(Buffer.from("\x1b[1;8;9mX\x1b[0mY"))
        for (const cell of [backend.getCell(0, 0), backend.getRow(0)[0], backend.getRows()[0]?.[0]]) {
          expect(cell).toMatchObject({ char: "X", bold: true, hidden: null, strikethrough: null })
        }
        for (const cell of [backend.getCell(0, 1), backend.getRow(0)[1], backend.getRows()[0]?.[1]]) {
          expect(cell).toMatchObject({ char: "Y", bold: false, hidden: null, strikethrough: null })
        }
        for (const cell of [
          backend.getCell(1, 0),
          backend.getRow(1)[0],
          backend.getRows()[1]?.[0],
          backend.getCell(2, 0),
          backend.getRow(2)[0],
        ]) {
          expect(cell).toMatchObject({ bold: false, hidden: null, strikethrough: null })
        }
      } finally {
        backend.destroy()
      }
    })

    test("mode readback distinguishes unexposed modes from measured set/reset state", () => {
      const backend = createVt100RustBackend({ cols: 20, rows: 3 })
      try {
        // The pinned crate has no DECAWM state; default wrapping is not a mode measurement.
        expect.soft(backend.getMode("autoWrap")).toBeNull()
        expect.soft(backend.getMode("reverseVideo")).toBeNull()
        expect.soft(backend.getMode("smoothScroll")).toBeNull()
        expect(backend.getMode("applicationCursor")).toBe(false)
        backend.feed(Buffer.from("\x1b[?1h"))
        expect(backend.getMode("applicationCursor")).toBe(true)
        backend.feed(Buffer.from("\x1b[?1l"))
        expect(backend.getMode("applicationCursor")).toBe(false)
      } finally {
        backend.destroy()
      }
    })

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

    // Accepted requirement: expose completed OSC 7 and literal OSC 633 P Cwd from this
    // parser's public callback. Title/notification tests do not exercise that metadata slot.
    test("Cwd callback retains completed literal values and follows its native parser lifetime", () => {
      const backend = createVt100RustBackend({ cols: 20, rows: 2 })
      const other = createVt100RustBackend({ cols: 20, rows: 2 })
      const feed = (text: string): void => backend.feed(Buffer.from(text))
      try {
        expectTypeOf(backend.getCwd).returns.toEqualTypeOf<string | null>()
        expect(backend.getCwd()).toBeNull()
        feed("\x1b]7;file://localhost/cwd-A")
        expect(backend.getCwd()).toBeNull()
        feed("\x1b\\")
        expect(backend.getCwd()).toBe("file://localhost/cwd-A")
        feed("\x1b]633;P;Cwd=/literal\\x3b;räv\x07")
        expect(backend.getCwd()).toBe("/literal\\x3b;räv")
        feed("\x1b]633;A\x07\x1b]633;P;Other=ignored\x07\x1b]633;P;Cwd\x07\x1b]633;p;Cwd=ignored\x07")
        expect(backend.getCwd()).toBe("/literal\\x3b;räv")
        feed("\x1b]7;file://remote.example/cwd-B;tail\x07")
        expect(backend.getCwd()).toBe("file://remote.example/cwd-B;tail")
        expect(other.getCwd()).toBeNull()

        // The measured vt100 0.16.2 callback has at most 16 fields, including the command.
        // Match only the delivered fields; raw bytes after that boundary are not recovered.
        const fields = Array.from({ length: 20 }, (_, i) => `part-${i}`)
        feed(`\x1b]7;${fields.join(";")}\x07`)
        expect(backend.getCwd()).toBe(fields.slice(0, 15).join(";"))
        feed(`\x1b]633;P;Cwd=${fields.join(";")}\x07`)
        expect(backend.getCwd()).toBe(fields.slice(0, 14).join(";"))
        backend.feed(Buffer.concat([Buffer.from("\x1b]7;file:///bad-"), Buffer.from([0xff, 0x2d, 0xc3, 0x28, 0x07])]))
        expect(backend.getCwd()).toBe("file:///bad-�-�(")
        feed("\x1b]7;\x07")
        expect(backend.getCwd()).toBeNull()
        feed("\x1b]7;file:///before-empty-633\x07\x1b]633;P;Cwd=\x07")
        expect(backend.getCwd()).toBeNull()
        feed("\x1b]7;file:///before-reset\x07")
        backend.reset()
        expect(backend.getCwd()).toBeNull()
        feed("\x1b]633;P;Cwd=/after-reset\x07")
        expect(backend.getCwd()).toBe("/after-reset")
        backend.init({ cols: 20, rows: 2 })
        expect(backend.getCwd()).toBeNull()
        backend.destroy()
        expect(() => backend.getCwd()).toThrow("not initialized")
      } finally {
        backend.destroy()
        other.destroy()
      }
    })

    // Accepted requirement: expose this parser's public unhandled_osc callback. Existing title
    // and clipboard tests exercise different callbacks and miss discarded notification payloads.
    test("OSC 9 public callback retains ordered native payloads without other OSC commands", () => {
      const backend = createVt100RustBackend({ cols: 20, rows: 2 })
      const feed = (text: string): void => backend.feed(Buffer.from(text))
      try {
        feed("\x1b]2;native title control\x07")
        expect(backend.getTitle()).toBe("native title control")
        expect(hasExtension(backend, "osc-metadata")).toBe(true)
        if (!hasExtension<OscMetadataExtension>(backend, "osc-metadata") || !backend.getNotifications) {
          throw new Error("vt100-rust osc-metadata lacks its notification callback reader")
        }
        expect(backend.getNotifications()).toEqual([])
        feed("\x1b]777;notify;other;command\x07plain")
        expect(backend.getNotifications()).toEqual([])
        expect(backend.getText()).toContain("plain")
        feed("\x1b]9;first;payload\x07\x1b]9;4;1;50\x1b\\\x1b]9;räv;尾\x07")
        expect(backend.getNotifications()).toEqual(["first;payload", "4;1;50", "räv;尾"])
        feed("\x1b]9\x07\x1b]9;\x07\x1b]9;split")
        expect(backend.getNotifications()).toEqual(["first;payload", "4;1;50", "räv;尾", "", ""])
        feed(" payload;\x07")
        expect(backend.getNotifications()).toEqual(["first;payload", "4;1;50", "räv;尾", "", "", "split payload;"])
        const copy = backend.getNotifications() as string[]
        copy.push("not a native callback")
        expect(backend.getNotifications()).toHaveLength(6)
      } finally {
        backend.destroy()
      }
    })

    // Accepted lifecycle: the existing native reset replaces its callbacks; a new parser has no
    // inherited observations. Do not let a native-availability skip substitute for these controls.
    test("OSC 9 public callback storage resets with its native parser lifetime", () => {
      const backend = createVt100RustBackend({ cols: 20, rows: 2 })
      try {
        expect(hasExtension(backend, "osc-metadata")).toBe(true)
        if (!hasExtension<OscMetadataExtension>(backend, "osc-metadata") || !backend.getNotifications) {
          throw new Error("vt100-rust osc-metadata lacks its notification callback reader")
        }
        backend.feed(Buffer.from("\x1b]9;old observation\x07"))
        expect(backend.getNotifications()).toEqual(["old observation"])
        backend.reset()
        expect(backend.getNotifications()).toEqual([])
        backend.feed(Buffer.from("\x1b]9;after reset\x07"))
        expect(backend.getNotifications()).toEqual(["after reset"])
        backend.init({ cols: 20, rows: 2 })
        expect(backend.getNotifications()).toEqual([])
        backend.destroy()
        expect(() => backend.getNotifications!()).toThrow("not initialized")
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

// Accepted requirement (@cto 5139d15b + 964e7295, vt100-rust #31295): the existing shared encoder reads the native
// engine's own stored mouse state through an adapter-private getter. vt100 0.16.2 stores ONE effective protocol and ONE
// encoding (screen.rs:683-700: set replaces, `?Nl` clears only when equal), so the last set mode wins by the engine's own
// rule and 1015/1016 leave the stored encoding unchanged. Existing tests read only the aggregate mouseTracking boolean,
// so a missing, stale or inferred mouse binding went unseen.
// @failure The vt100-rust mouse extension encodes reset state, invents an encoding the engine never stored, or the
//   private getter leaks onto the public native type.
// @level l0
// @consumer terminfo library mouse arms (mouseEncodingLib) reading getMode("mouseTracking") then encodeMouse.
describe.skipIf(nativeBuildError !== null)(
  `vt100-rust mouse encoding${nativeBuildError ? ` (unavailable: ${nativeBuildError})` : ""}`,
  () => {
    const reset = "\x1b[?9;1000;1002;1003;1005;1006l"
    const event = { x: 4, y: 2, button: "left", action: "press" } as const
    const encode = (b: TerminalBackend, e: MouseEvent) => (b as TerminalBackend & MouseEncodingExtension).encodeMouse(e)
    const text = (bytes: Uint8Array | null) => (bytes === null ? null : new TextDecoder().decode(bytes))

    test.each([
      ["\x1b[?9h", event, "\x1b[M %#"],
      ["\x1b[?1000h", { ...event, action: "release" }, "\x1b[M#%#"],
      ["\x1b[?1000h\x1b[?1006h", event, "\x1b[<0;5;3M"],
      ["\x1b[?1000h\x1b[?1006h", { ...event, button: "wheelUp" }, "\x1b[<64;5;3M"],
      ["\x1b[?1002h\x1b[?1006h", { ...event, action: "move" }, "\x1b[<32;5;3M"],
      ["\x1b[?1003h\x1b[?1006h", { ...event, button: "none", action: "move" }, "\x1b[<35;5;3M"],
      ["\x1b[?1000h\x1b[?1005h", { ...event, x: 200 }, "\x1b[M é#"],
    ] as const)("encodes the engine's own stored mouse state %j", (setup, mouse, report) => {
      const backend = createVt100RustBackend({ cols: 300, rows: 24 })
      try {
        expect(backend.capabilities.extensions.has("mouse-encoding")).toBe(true)
        expect(backend.getMode("mouseTracking")).toBe(false)
        expect(encode(backend, mouse)).toBeNull()
        backend.feed(Buffer.from(setup))
        expect(backend.getMode("mouseTracking")).toBe(true)
        expect(text(encode(backend, mouse))).toBe(report)
        backend.feed(Buffer.from(reset))
        expect(backend.getMode("mouseTracking")).toBe(false)
        expect(encode(backend, mouse)).toBeNull()
        backend.feed(Buffer.from(setup))
        backend.reset()
        expect(encode(backend, mouse)).toBeNull()
      } finally {
        backend.destroy()
      }
    })

    test("follows the engine's single stored state, never an invented one", () => {
      const backend = createVt100RustBackend({ cols: 80, rows: 24 })
      try {
        // Last set protocol wins (set_mouse_mode replaces); clearing a mode that is not current changes nothing.
        backend.feed(Buffer.from("\x1b[?1000h\x1b[?1002h\x1b[?1006h"))
        expect(text(encode(backend, { ...event, action: "move" }))).toBe("\x1b[<32;5;3M")
        backend.feed(Buffer.from("\x1b[?1000l"))
        expect(text(encode(backend, { ...event, action: "move" }))).toBe("\x1b[<32;5;3M")
        // 1015/1016 are not stored by vt100 0.16.2: the stored SGR encoding stays.
        backend.feed(Buffer.from("\x1b[?1015h\x1b[?1016h"))
        expect(text(encode(backend, event))).toBe("\x1b[<0;5;3M")
        // X10 reports presses only.
        backend.feed(Buffer.from(`${reset}\x1b[?9h`))
        expect(encode(backend, { ...event, action: "release" })).toBeNull()
      } finally {
        backend.destroy()
      }
    })

    // Quality review (@chief a70b7508): the positive cases above are valid under broader tracking modes, and the tracking
    // reset masks encoding reset, so a 1000/1002->1003 mapping slip or a stuck encoding passed every earlier assertion.
    test("each stored protocol reports only its own motion events", () => {
      const backend = createVt100RustBackend({ cols: 80, rows: 24 })
      const drag = { ...event, action: "move" } as const
      const bareMove = { ...event, button: "none", action: "move" } as const
      try {
        backend.feed(Buffer.from("\x1b[?1000h\x1b[?1006h"))
        expect(encode(backend, drag)).toBeNull()
        backend.feed(Buffer.from("\x1b[?1002h"))
        expect(text(encode(backend, drag))).toBe("\x1b[<32;5;3M")
        expect(encode(backend, bareMove)).toBeNull()
        backend.feed(Buffer.from("\x1b[?1003h"))
        expect(text(encode(backend, bareMove))).toBe("\x1b[<35;5;3M")
      } finally {
        backend.destroy()
      }
    })

    test("the stored encoding is replaced, kept on a noncurrent reset and returns to legacy on its own reset", () => {
      const backend = createVt100RustBackend({ cols: 300, rows: 24 })
      // x=95 reports column 96: SGR "96", UTF-8 U+0080 (two bytes), legacy one raw 0x80 byte.
      const wide = { ...event, x: 95 } as const
      const bytes = () => [...encode(backend, wide)!]
      try {
        backend.feed(Buffer.from("\x1b[?1000h\x1b[?1006h"))
        expect(text(encode(backend, wide))).toBe("\x1b[<0;96;3M")
        backend.feed(Buffer.from("\x1b[?1005h"))
        expect(bytes()).toEqual([0x1b, 0x5b, 0x4d, 0x20, 0xc2, 0x80, 0x23])
        backend.feed(Buffer.from("\x1b[?1006l"))
        expect(bytes()).toEqual([0x1b, 0x5b, 0x4d, 0x20, 0xc2, 0x80, 0x23])
        backend.feed(Buffer.from("\x1b[?1005l"))
        expect(backend.getMode("mouseTracking")).toBe(true)
        expect(bytes()).toEqual([0x1b, 0x5b, 0x4d, 0x20, 0x80, 0x23])
      } finally {
        backend.destroy()
      }
    })

    test.each([
      ["getMouseProtocolMode", 1001, "protocol 1001 encoding 0"],
      ["getMouseProtocolEncoding", 1015, "protocol 1000 encoding 1015"],
    ] as const)("an unknown stored %s value %d reports unavailable, never a guessed report", (getter, value, named) => {
      const real = loadVt100RustNative().Vt100RustTerminal
      const unknown = class extends real {} as typeof real
      Object.defineProperty(unknown.prototype, getter, { value: () => value })
      const backend = createVt100RustBackend({ cols: 80, rows: 24 }, { Vt100RustTerminal: unknown })
      try {
        backend.feed(Buffer.from("\x1b[?1000h"))
        expect(() => encode(backend, event)).toThrow(`mouse encoding unavailable: native mouse state ${named}`)
      } finally {
        backend.destroy()
      }
    })

    test("an addon without the private mouse getters reports unavailable, never a guessed report", () => {
      const real = loadVt100RustNative().Vt100RustTerminal
      const stale = class extends real {} as typeof real
      for (const name of ["getMouseProtocolMode", "getMouseProtocolEncoding"]) {
        Object.defineProperty(stale.prototype, name, { value: undefined })
      }
      const backend = createVt100RustBackend({ cols: 80, rows: 24 }, { Vt100RustTerminal: stale })
      try {
        backend.feed(Buffer.from("\x1b[?1000h"))
        expect(() => encode(backend, event)).toThrow("mouse encoding unavailable:")
      } finally {
        backend.destroy()
      }
    })

    test("the public native terminal type gains no mouse members", () => {
      type PublicTerminal = InstanceType<ReturnType<typeof loadVt100RustNative>["Vt100RustTerminal"]>
      expectTypeOf<Extract<keyof PublicTerminal, `${string}Mouse${string}`>>().toEqualTypeOf<never>()
    })
  },
)
