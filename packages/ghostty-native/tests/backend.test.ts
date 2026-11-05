/**
 * @failure Ghostty native readback drops title/URI/style metadata or fabricates unset default colors.
 * @level l0
 * @consumer Termless Ghostty native backend cell observations.
 * @testonly none
 */

import { describe, test, expect, vi } from "vitest"
import { createGhosttyNativeBackend, loadGhosttyNative } from "../src/backend.ts"
import type { HyperlinkExtension, Color } from "../../../src/terminal/types.ts"

let nativeBuildError: string | null = null
try {
  loadGhosttyNative()
} catch (error) {
  nativeBuildError = error instanceof Error ? error.message : String(error)
}

describe.skipIf(nativeBuildError !== null)(
  `Ghostty native backend attributes${nativeBuildError ? ` (unavailable: ${nativeBuildError})` : ""}`,
  () => {
    test("native key encoding follows the same handle's modes and lifecycle", () => {
      const native = loadGhosttyNative()
      const spy = vi.spyOn(native, "encodeKey")
      const backend = createGhosttyNativeBackend({ cols: 10, rows: 2 })
      const other = createGhosttyNativeBackend({ cols: 10, rows: 2 })
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()
      const onResponse = vi.fn()
      backend.onResponse = onResponse
      try {
        expect(backend.capabilities.extensions.has("key-encoding")).toBe(true)
        expect(decoder.decode(backend.encodeKey({ key: "ArrowUp" }))).toBe("\x1b[A")
        backend.feed(encoder.encode("one\r\ntwo\r\nthree\x1b[?1h"))
        const before = {
          text: backend.getText(),
          cursor: backend.getCursor(),
          lines: backend.getLines(),
          scrollback: backend.getScrollback(),
        }
        expect(backend.getMode("applicationCursor")).toBe(true)
        expect(decoder.decode(backend.encodeKey({ key: "ArrowUp" }))).toBe("\x1bOA")
        expect(decoder.decode(other.encodeKey({ key: "ArrowUp" }))).toBe("\x1b[A")
        expect({
          text: backend.getText(),
          cursor: backend.getCursor(),
          lines: backend.getLines(),
          scrollback: backend.getScrollback(),
        }).toEqual(before)
        expect(decoder.decode(backend.encodeKey({ key: "é" }))).toBe("é")
        expect(decoder.decode(backend.encodeKey({ key: "😀" }))).toBe("😀")
        expect(decoder.decode(backend.encodeKey({ key: "two scalars" }))).toBe("two scalars")
        expect([...backend.encodeKey({ key: "Control" })]).toEqual([])
        backend.encodeKey({ key: "F12", shift: true, ctrl: true, alt: true, super: true })
        expect(spy).toHaveBeenLastCalledWith(expect.anything(), "f12", "", 0, true, true, true, true)
        backend.encodeKey({ key: "A", shift: true })
        expect(spy).toHaveBeenLastCalledWith(expect.anything(), "unidentified", "A", 97, true, false, false, false)
        expect(onResponse).not.toHaveBeenCalled()
        backend.feed(encoder.encode("\x1b[?1l"))
        expect(decoder.decode(backend.encodeKey({ key: "ArrowUp" }))).toBe("\x1b[A")
        backend.feed(encoder.encode("\x1b[?1h"))
        backend.reset()
        expect(backend.getMode("applicationCursor")).toBe(false)
        expect(decoder.decode(backend.encodeKey({ key: "ArrowUp" }))).toBe("\x1b[A")
      } finally {
        spy.mockRestore()
        backend.destroy()
        other.destroy()
      }
      expect(() => backend.encodeKey({ key: "a" })).toThrow(/not initialized/)
      backend.init({ cols: 10, rows: 2 })
      try {
        expect(decoder.decode(backend.encodeKey({ key: "ArrowUp" }))).toBe("\x1b[A")
      } finally {
        backend.destroy()
      }
      expect(() => createGhosttyNativeBackend().encodeKey({ key: "a" })).toThrow(/not initialized/)
    })

    test("native key validation rejects ambiguous events and returns owned bytes", () => {
      const native = loadGhosttyNative()
      const handle = native.createTerminal(10, 2, 100)
      const backend = createGhosttyNativeBackend({ cols: 10, rows: 2 })
      let result: Uint8Array
      try {
        const encode = (tag: string, text: string, scalar: number, shift = false) =>
          native.encodeKey(handle, tag, text, scalar, shift, false, false, false)
        expect(() => encode("unknown_native_tag", "", 0)).toThrow()
        expect(() => encode("unidentified", "a", 0xd800)).toThrow()
        expect(() => encode("unidentified", "a", 0x110000)).toThrow()
        expect(() => encode("unidentified", "ab", 97, true)).toThrow()
        expect(() => backend.encodeKey({ key: "\ud800" })).toThrow(/Unicode scalar/)
        expect(() => backend.encodeKey({ key: "ab", ctrl: true })).toThrow(/multi-scalar/)
        expect(() => backend.encodeKey({ key: "" })).toThrow(/Unicode scalar/)
        result = encode("unidentified", "é", 233)
        expect(result).toBeInstanceOf(Uint8Array)
        expect([...encode("control_left", "", 0)]).toEqual([])
      } finally {
        native.destroyTerminal(handle)
        backend.destroy()
      }
      expect([...result!]).toEqual([...new TextEncoder().encode("é")])
    })

    test("an old addon missing native key encoding gives the existing rebuild guidance", () => {
      const native = loadGhosttyNative()
      const backend = createGhosttyNativeBackend({ cols: 10, rows: 2 })
      const original = native.encodeKey
      try {
        Object.defineProperty(native, "encodeKey", { value: undefined, configurable: true, writable: true })
        expect(() => backend.encodeKey({ key: "a" })).toThrow(/predates encodeKey.*rebuild/s)
        expect(() => backend.encodeKey({ key: "a" })).toThrow(/cd packages\/ghostty-native && bash build\/build.sh/)
      } finally {
        Object.defineProperty(native, "encodeKey", { value: original, configurable: true, writable: true })
        backend.destroy()
      }
    })

    // Native text rules and lifecycle belong to the real addon, not a shared host encoder.
    test("encodes native paste on the same handle without callbacks or state changes", () => {
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()
      const backend = createGhosttyNativeBackend({ cols: 10, rows: 2 })
      const other = createGhosttyNativeBackend({ cols: 10, rows: 2 })
      const onResponse = vi.fn()
      backend.onResponse = onResponse
      try {
        expect(backend.capabilities.extensions.has("paste-encoding")).toBe(true)
        expect([...backend.encodePaste("")]).toEqual([])
        expect(decoder.decode(backend.encodePaste("é中😀\t\n\r\r\n\x1b\x00"))).toBe("é中😀\t\r\r\r\r  ")
        backend.feed(encoder.encode("one\r\ntwo\r\nthree\x1b[?2004h\x1b[20h"))
        const before = {
          text: backend.getText(),
          cursor: backend.getCursor(),
          scrollback: backend.getScrollback(),
          lines: backend.getLines(),
          mode: backend.getMode("bracketedPaste"),
        }
        const result = backend.encodePaste("é中😀\t\n\r\r\n\x1b[201~\x00")
        expect(result).toBeInstanceOf(Uint8Array)
        expect(decoder.decode(result)).toBe("\x1b[200~é中😀\t\n\r\r\n [201~ \x1b[201~")
        expect(decoder.decode(backend.encodePaste(""))).toBe("\x1b[200~\x1b[201~")
        expect(decoder.decode(other.encodePaste("x\n"))).toBe("x\r")
        expect({
          text: backend.getText(),
          cursor: backend.getCursor(),
          scrollback: backend.getScrollback(),
          lines: backend.getLines(),
          mode: backend.getMode("bracketedPaste"),
        }).toEqual(before)
        expect(onResponse).not.toHaveBeenCalled()
        backend.feed(encoder.encode("\x1b[?2004l"))
        expect(decoder.decode(backend.encodePaste("x\n"))).toBe("x\r")
        backend.feed(encoder.encode("\x1b[?2004h"))
        backend.reset()
        expect(backend.getMode("bracketedPaste")).toBe(false)
        expect(decoder.decode(backend.encodePaste("x\n"))).toBe("x\r")
      } finally {
        backend.destroy()
        other.destroy()
      }
      expect(() => backend.encodePaste("x")).toThrow(/not initialized/)
      backend.init({ cols: 10, rows: 2 })
      try {
        expect(decoder.decode(backend.encodePaste("x\n"))).toBe("x\r")
      } finally {
        backend.destroy()
      }
      const uninitialized = createGhosttyNativeBackend()
      expect(() => uninitialized.encodePaste("x")).toThrow(/not initialized/)
    })

    test("native paste copies byte views and returns owned bytes, including empty input", () => {
      const native = loadGhosttyNative()
      const handle = native.createTerminal(10, 2, 100)
      const encoder = new TextEncoder()
      const backing = encoder.encode("!é中\n\x1b?")
      const original = backing.slice()
      let result: Uint8Array
      try {
        const view = backing.subarray(1, backing.length - 1)
        result = native.encodePaste(handle, view)
        expect(result).toBeInstanceOf(Uint8Array)
        expect([...result]).toEqual([...encoder.encode("é中\r ")])
        expect(backing).toEqual(original)
        expect([...native.encodePaste(handle, new Uint8Array())]).toEqual([])
        expect(() => native.encodePaste(handle, new Uint16Array([1]) as unknown as Uint8Array)).toThrow()
      } finally {
        native.destroyTerminal(handle)
      }
      expect([...result!]).toEqual([...encoder.encode("é中\r ")])
    })

    test("an old addon missing native paste gives the existing rebuild guidance", () => {
      const native = loadGhosttyNative()
      const backend = createGhosttyNativeBackend({ cols: 10, rows: 2 })
      const original = native.encodePaste
      try {
        Object.defineProperty(native, "encodePaste", { value: undefined, configurable: true, writable: true })
        expect(() => backend.encodePaste("x")).toThrow(/predates encodePaste.*rebuild it:/s)
        expect(() => backend.encodePaste("x")).toThrow(/cd packages\/ghostty-native && bash build\/build.sh/)
      } finally {
        Object.defineProperty(native, "encodePaste", { value: original, configurable: true, writable: true })
        backend.destroy()
      }
    })

    /**
     * @failure #32271: Ghostty emits every OSC 9;4 as a progress_report action (332b2aef stream.zig:2042-2043), but the
     * embedding forwarded it to a readonly handler that ignores it, so no reader saw the report Ghostty parsed.
     * @consumer Terminfo extensions.osc9-progress through osc-metadata getProgress
     */
    test("reads the engine-emitted OSC 9;4 report verbatim, null before the first", () => {
      const backend = createGhosttyNativeBackend({ cols: 20, rows: 3 })
      const feed = (data: string) => backend.feed(new TextEncoder().encode(data))
      try {
        expect(backend.capabilities.extensions.has("osc-metadata")).toBe(true)
        expect(backend.getProgress()).toBeNull()
        // Ghostty's parser rejects an unknown state digit (osc9.zig:186), so no report is emitted.
        feed("\x1b]9;4;x\x07")
        expect(backend.getProgress()).toBeNull()
        feed("\x1b]9;4;1;37\x07")
        const first = backend.getProgress()
        expect(first).toEqual({ state: 1, value: 37 })
        first!.value = 99
        expect(backend.getProgress()).toEqual({ state: 1, value: 37 })
        feed("\x1b]9;4;2;64\x07")
        expect(backend.getProgress()).toEqual({ state: 2, value: 64 })
        // remove and indeterminate carry no progress in Ghostty's report (osc9.zig:188), so value is null.
        feed("\x1b]9;4;3\x1b\\")
        expect(backend.getProgress()).toEqual({ state: 3, value: null })
        feed("\x1b]9;4;0\x07X")
        expect(backend.getProgress()).toEqual({ state: 0, value: null })
        expect(backend.getCell(0, 0).char).toBe("X")
      } finally {
        backend.destroy()
      }
    })

    /**
     * @failure #32272: Ghostty emits every OSC 9 and OSC 777 notify as a show_desktop_notification action
     * (332b2aef stream.zig:2022-2027), but the embedding forwarded it to a readonly handler that ignores it
     * (stream_readonly.zig:187), so no reader saw the toasts Ghostty parsed.
     * @consumer Terminfo extensions.notifications and extensions.osc777-notify through osc-metadata getToasts
     */
    test("stores every engine-emitted toast verbatim and in order; init empties it", () => {
      const backend = createGhosttyNativeBackend({ cols: 20, rows: 3 })
      const feed = (data: string) => backend.feed(new TextEncoder().encode(data))
      try {
        expect(backend.getToasts()).toEqual([])
        // Non-toast sequences of both families store nothing: ConEmu progress, and an rxvt extension other than notify.
        feed("\x1b]9;4;0\x07\x1b]777;preexec\x07")
        expect(backend.getToasts()).toEqual([])
        // Ghostty requires the title separator for 777 notify (rxvt_extension.zig:30-34), so this stores nothing.
        feed("\x1b]777;notify;lonely\x07")
        expect(backend.getToasts()).toEqual([])
        feed("\x1b]9;nine body\x07")
        feed("\x1b]777;notify;T777;B777\x1b\\")
        feed("\x1b]777;notify;;empty title\x07X")
        // OSC 9 builds title "" (osc9.zig:279-281); 777 keeps its title, an empty one stays "".
        const toasts = backend.getToasts()
        expect(toasts).toEqual([
          { title: "", body: "nine body" },
          { title: "T777", body: "B777" },
          { title: "", body: "empty title" },
        ])
        toasts[0]!.body = "mutated"
        // The type is readonly; the runtime array is a copy the caller may change without touching the store.
        ;(toasts as { title: string | null; body: string }[]).pop()
        expect(backend.getToasts()).toHaveLength(3)
        expect(backend.getToasts()[0]).toEqual({ title: "", body: "nine body" })
        expect(backend.getCell(0, 0).char).toBe("X")
        backend.init({ cols: 20, rows: 3 })
        expect(backend.getToasts()).toEqual([])
      } finally {
        backend.destroy()
      }
      expect(() => backend.getToasts()).toThrow("not initialized")
    })

    // Cell and style readback cannot catch an engine title event dropped by the embedding.
    test.each([
      { name: "inert control", steps: [{ data: "X", title: "" }] },
      { name: "OSC 2 title", steps: [{ data: "\x1b]2;terminfo-title-control\x07X", title: "terminfo-title-control" }] },
      {
        name: "replacement title",
        steps: [
          { data: "\x1b]2;first-title\x07", title: "first-title" },
          { data: "\x1b]2;second-title\x07X", title: "second-title" },
        ],
      },
    ])("reads the engine window title: $name", ({ steps }) => {
      const backend = createGhosttyNativeBackend({ cols: 20, rows: 3 })
      try {
        for (const step of steps) {
          backend.feed(new TextEncoder().encode(step.data))
          expect(backend.getTitle()).toBe(step.title)
        }
        expect(backend.getCell(0, 0).char).toBe("X")
      } finally {
        backend.destroy()
      }
    })

    test("native unknown mode readback is null rather than a measured false", () => {
      const native = loadGhosttyNative()
      const handle = native.createTerminal(20, 3, 0)
      try {
        expect(native.getMode(handle, "cursorVisible")).toBe(true)
        expect(native.getMode(handle, "untracked-mode")).toBeNull()
      } finally {
        native.destroyTerminal(handle)
      }
    })

    test.each([
      ["altScroll", 1007],
      ["syncOutput", 2026],
      ["colorSchemeReporting", 2031],
      ["smoothScroll", 4],
    ] as const)("%s follows the native private-mode set/reset state", (mode, number) => {
      const backend = createGhosttyNativeBackend({ cols: 20, rows: 3 })
      try {
        backend.feed(new TextEncoder().encode(`\x1b[?${number}l`))
        expect(backend.getMode(mode)).toBe(false)
        backend.feed(new TextEncoder().encode(`\x1b[?${number}h`))
        expect(backend.getMode(mode)).toBe(true)
        if (mode === "smoothScroll") expect(backend.getMode("insertMode")).toBe(false)
        backend.feed(new TextEncoder().encode(`\x1b[?${number}l`))
        expect(backend.getMode(mode)).toBe(false)
      } finally {
        backend.destroy()
      }
    })

    // Existing style cases never observe conceal, which is independent of inverse video.
    test("preserves conceal enable and reset state through native cell and row readback", () => {
      const backend = createGhosttyNativeBackend({ cols: 6, rows: 1 })
      try {
        backend.feed(new TextEncoder().encode("A\x1b[8mB\x1b[28mC\x1b[7mD"))
        expect(backend.getCell(0, 0).hidden).toBe(false)
        expect(backend.getCell(0, 1).hidden).toBe(true)
        expect(backend.getCell(0, 2).hidden).toBe(false)
        expect(backend.getCell(0, 3)).toMatchObject({ inverse: true, hidden: false })
        expect(
          backend
            .getLine(0)
            .slice(0, 4)
            .map((cell) => cell.hidden),
        ).toEqual([false, true, false, false])
        expect(
          backend
            .getLines()[0]!
            .slice(0, 4)
            .map((cell) => cell.hidden),
        ).toEqual([false, true, false, false])
        backend.reset()
        expect(backend.getCell(0, 0).hidden).toBe(false)
      } finally {
        backend.destroy()
      }
    })

    // Existing URI/color cases never observe SGR 53/55 through the native cell projection.
    test("preserves overline enable and reset state through native cell and row readback", () => {
      const backend = createGhosttyNativeBackend({ cols: 6, rows: 1 })
      try {
        backend.feed(new TextEncoder().encode("A\x1b[53mB\x1b[55mC\x1b[53mD\x1b[0mE"))
        expect(backend.getCell(0, 1).overline).toBe(true)
        expect(
          backend
            .getLine(0)
            .slice(0, 5)
            .map((cell) => cell.overline),
        ).toEqual([false, true, false, true, false])

        backend.reset()
        expect(backend.getCell(0, 0).overline).toBe(false)
        expect(backend.getLines().map((row) => row.map((cell) => cell.overline))).toEqual([Array(6).fill(false)])
      } finally {
        backend.destroy()
      }
    })

    // Visible-cell and counter tests miss the absolute-buffer contract once retained rows precede the active screen.
    test("reads retained rows across viewport changes, alternate screens, resize and page eviction", () => {
      const backend = createGhosttyNativeBackend({ cols: 80, rows: 24, scrollbackLimit: 65536 })
      const encode = (text: string) => new TextEncoder().encode(text)
      const markers = Array.from(
        { length: 36 },
        (_, row) => `S${String(row).padStart(2, "0")}${row === 1 || row === 25 ? "界e\u0301" : ""}`,
      )
      const uri = "https://example.test:8443/retained:row"
      const lineText = (row: number) =>
        backend
          .getLine(row)
          .map((cell) => cell.char)
          .join("")
          .trimEnd()
      try {
        expect(backend.getLines()).toHaveLength(24)
        expect(backend.getLine(23)).toHaveLength(80)
        expect(lineText(23)).toBe("")
        backend.feed(
          encode(
            markers
              .map((marker, row) =>
                row === 0 || row === 24
                  ? `\x1b[1;38;2;17;34;51m\x1b]8;;${uri}\x1b\\${marker}\x1b]8;;\x1b\\\x1b[0m`
                  : marker,
              )
              .join("\r\n"),
          ),
        )
        expect(backend.getScrollback()).toMatchObject({ totalLines: 36, screenLines: 24 })
        expect(lineText(0)).toBe("S00")
        expect(
          backend.getLines().map((line) =>
            line
              .map((cell) => cell.char)
              .join("")
              .trimEnd(),
          ),
        ).toEqual(markers)
        for (const row of [0, 1, 11, 12, 24, 25, 35]) {
          expect(lineText(row)).toBe(markers[row])
          expect(backend.getTextRange(row, 0, row, 3)).toBe(markers[row]!.slice(0, 3))
        }
        expect(backend.getTextRange(11, 0, 12, 3)).toBe("S11".padEnd(80) + "\nS12")
        expect(
          backend
            .getText()
            .split("\n")
            .map((line) => line.trimEnd()),
        ).toEqual(markers)
        for (const row of [0, 24]) {
          const styled = { char: "S", bold: true, fg: { r: 17, g: 34, b: 51 }, hyperlink: uri }
          expect(backend.getCell(row, 0)).toMatchObject(styled)
          expect(backend.getLine(row)[0]).toMatchObject(styled)
          expect(backend.getLines()[row]?.[0]).toMatchObject(styled)
        }
        for (const row of [1, 25]) {
          expect(backend.getCell(row, 3)).toMatchObject({ char: "界", wide: true })
          expect(backend.getCell(row, 5).char).toBe("e\u0301")
        }
        // A JavaScript absolute row must not truncate to native u16 and alias row zero.
        expect(backend.getCell(65536, 0).char).toBe("")
        backend.scrollViewport(-5)
        expect(backend.getScrollback().viewportTop).toBe(7)
        expect(lineText(0)).toBe("S00")
        expect(lineText(12)).toBe("S12")
        backend.scrollViewport(5)
        backend.feed(encode("\x1b[?1049h\x1b[HALT"))
        expect(backend.getMode("altScreen")).toBe(true)
        expect(backend.getScrollback()).toMatchObject({ totalLines: 24, screenLines: 24, viewportTop: 0 })
        expect(backend.getLines()).toHaveLength(24)
        expect(lineText(0)).toBe("ALT")
        expect(lineText(23)).toBe("")
        expect(backend.getText()).not.toContain("S00")
        backend.feed(encode("\x1b[?1049l"))
        expect(backend.getMode("altScreen")).toBe(false)
        expect(backend.getLines()).toHaveLength(36)
        expect(lineText(0)).toBe("S00")
        expect(lineText(12)).toBe("S12")
        backend.resize(60, 24)
        expect(backend.getLines()).toHaveLength(36)
        expect(backend.getLines().every((line) => line.length === 60)).toBe(true)
        expect(
          backend
            .getText()
            .split("\n")
            .map((line) => line.trimEnd()),
        ).toEqual(markers)
        // Ghostty caps history by page memory; compare actual retained rows rather than assuming a line cap.
        const later = Array.from({ length: 2000 }, (_, row) => `R${String(row).padStart(4, "0")}`)
        backend.feed(encode("\r\n" + later.join("\r\n")))
        const total = backend.getScrollback().totalLines
        expect(total).toBeLessThan(markers.length + later.length)
        expect(total).toBeGreaterThanOrEqual(24)
        const retained = [...markers, ...later].slice(-total)
        expect(
          backend.getLines().map((line) =>
            line
              .map((cell) => cell.char)
              .join("")
              .trimEnd(),
          ),
        ).toEqual(retained)
        expect(lineText(0)).toBe(retained[0])
        expect(lineText(total - 1)).toBe("R1999")
      } finally {
        backend.destroy()
      }
    })

    // Existing URI scroll tests observe cells, not the absolute buffer coordinate or its legacy mirror.
    test("reports absolute viewport rows through scrolling", () => {
      const backend = createGhosttyNativeBackend({ cols: 20, rows: 3 })
      try {
        expect(backend.getScrollback()).toEqual({
          viewportTop: 0,
          totalRows: 3,
          screenRows: 3,
          viewportOffset: 0,
          totalLines: 3,
          screenLines: 3,
        })
        backend.feed(new TextEncoder().encode("0\r\n1\r\n2\r\n3\r\n4\r\n5\r\n6\r\n7"))
        const expectPosition = (top: number): void => {
          expect(backend.getScrollback()).toEqual({
            viewportTop: top,
            totalRows: 8,
            screenRows: 3,
            viewportOffset: top,
            totalLines: 8,
            screenLines: 3,
          })
        }
        expectPosition(5)
        backend.scrollViewport(-2)
        expectPosition(3)
        backend.scrollViewport(-100)
        expectPosition(0)
        backend.scrollViewport(100)
        expectPosition(5)
      } finally {
        backend.destroy()
      }
    })

    // Existing URI/blink tests never observe the distinct stored SGR 58/59 color.
    test("preserves indexed, truecolor and reset underline colors through the cell ABI", () => {
      const backend = createGhosttyNativeBackend({ cols: 6, rows: 1 })
      try {
        backend.feed(new TextEncoder().encode("\x1b[4;38;5;5mC\x1b[58;5;5mI\x1b[58;2;255;0;128mR\x1b[59mD\x1b[0m"))
        const palette5 = { r: 178, g: 148, b: 187 }
        expect(backend.getCell(0, 0)).toMatchObject({ char: "C", fg: palette5, underlineColor: null })
        expect(backend.getCell(0, 1)).toMatchObject({ char: "I", underline: "single", underlineColor: palette5 })
        expect(backend.getCell(0, 2).underlineColor).toEqual({ r: 255, g: 0, b: 128 })
        expect(backend.getCell(0, 3).underlineColor).toBeNull()
        expect(
          backend
            .getLine(0)
            .slice(0, 4)
            .map((cell) => cell.underlineColor),
        ).toEqual([null, palette5, { r: 255, g: 0, b: 128 }, null])
      } finally {
        backend.destroy()
      }
    })

    test("surfaces native cell-read errors and malformed URI metadata", () => {
      const native = loadGhosttyNative()
      const backend = createGhosttyNativeBackend()
      backend.init({ cols: 4, rows: 1 })
      const error = new Error("native read failed")
      const spies = [
        vi.spyOn(native, "getCell").mockImplementation(() => {
          throw error
        }),
        vi.spyOn(native, "getLine").mockImplementation(() => {
          throw error
        }),
        vi.spyOn(native, "getLines").mockImplementation(() => {
          throw error
        }),
      ]
      try {
        expect(() => backend.getCell(0, 0)).toThrow(error)
        expect(() => backend.getLine(0)).toThrow(error)
        expect(() => backend.getLines()).toThrow(error)
      } finally {
        spies.forEach((spy) => spy.mockRestore())
      }
      const actual = native.getCell
      const malformed = vi.spyOn(native, "getCell").mockImplementation(
        (handle, row, col) =>
          ({
            ...actual(handle, row, col),
            hyperlink: undefined,
          }) as unknown as ReturnType<typeof actual>,
      )
      try {
        expect(() => backend.getCell(0, 0)).toThrow(/hyperlink/)
      } finally {
        malformed.mockRestore()
        backend.destroy()
      }
    })

    test("preserves stored URI through cell, line and extension reads across buffer changes", () => {
      const backend = createGhosttyNativeBackend() as ReturnType<typeof createGhosttyNativeBackend> & HyperlinkExtension
      backend.init({ cols: 20, rows: 3 })
      const feed = (text: string) => backend.feed(new TextEncoder().encode(text))
      const uri = "https://example.com:8443/a:b"
      try {
        feed(`A\x1b]8;id=explicit;${uri}\x1b\\LINK\x1b]8;;\x1b\\Z`)
        expect(backend.getCell(0, 1).hyperlink).toBe(uri)
        expect(backend.capabilities.extensions.has("hyperlinks")).toBe(true)
        expect(
          backend
            .getLine(0)
            .slice(0, 6)
            .map((cell) => cell.hyperlink),
        ).toEqual([null, uri, uri, uri, uri, null])
        expect(Array.from({ length: 6 }, (_, col) => backend.getHyperlinkAt(0, col))).toEqual([
          null,
          uri,
          uri,
          uri,
          uri,
          null,
        ])
        const saved = backend.getCell(0, 1).hyperlink
        feed("\x1b[?1049h\x1b[H\x1b]8;;https://alt.example/\x1b\\Q\x1b]8;;\x1b\\")
        expect(backend.getHyperlinkAt(0, 0)).toBe("https://alt.example/")
        feed("\x1b[?1049l")
        expect(backend.getHyperlinkAt(0, 1)).toBe(uri)
        backend.resize(24, 4)
        expect(backend.getHyperlinkAt(0, 1)).toBe(uri)
        feed("\x1b[2J\x1b[Hplain")
        expect(backend.getHyperlinkAt(0, 1)).toBeNull()
        expect(saved).toBe(uri)
        backend.reset()
        backend.resize(20, 3)
        feed(`\x1b]8;;${uri}\x1b\\HIST\x1b]8;;\x1b\\\r\nmiddle\r\nlast\r\nbottom`)
        const firstScreenRow = backend.getScrollback().totalLines - backend.getScrollback().screenLines
        expect(backend.getCell(firstScreenRow, 0)).toMatchObject({ char: "m", hyperlink: null })
        expect(backend.getCell(0, 0)).toMatchObject({ char: "H", hyperlink: uri })
        backend.scrollViewport(-1)
        expect(backend.getCell(0, 0)).toMatchObject({ char: "H", hyperlink: uri })
        expect(backend.getHyperlinkAt(0, 0)).toBe(uri)
        expect(backend.getLine(0)[0]).toMatchObject({ char: "H", hyperlink: uri })
        backend.scrollViewport(1)
        expect(backend.getHyperlinkAt(firstScreenRow, 0)).toBeNull()
        expect(backend.getHyperlinkAt(0, 0)).toBe(uri)
      } finally {
        backend.destroy()
      }
      expect(() => backend.getHyperlinkAt(0, 0)).toThrow(/not initialized/)
    })

    test("reports all unset defaults, exact OSC overrides, resets and lifetime errors", () => {
      // The raw baseline read detects fabricated white/black before the public getter exists.
      const native = loadGhosttyNative()
      const handle = native.createTerminal(4, 1, 10)
      try {
        expect(native.getDefaultColors(handle)).toEqual({
          fg_r: -1,
          fg_g: -1,
          fg_b: -1,
          bg_r: -1,
          bg_g: -1,
          bg_b: -1,
          cursor_r: -1,
          cursor_g: -1,
          cursor_b: -1,
        })
      } finally {
        native.destroyTerminal(handle)
      }
      const backend = createGhosttyNativeBackend() as ReturnType<typeof createGhosttyNativeBackend> & {
        getDefaultColors(): { fg: Color | null; bg: Color | null; cursor: Color | null }
      }
      expect(() => backend.getDefaultColors()).toThrow(/not initialized/)
      backend.init({ cols: 4, rows: 1 })
      try {
        expect(backend.capabilities.extensions.has("default-colors")).toBe(true)
        const baseline = { fg: null, bg: null, cursor: null }
        expect(backend.getDefaultColors()).toEqual(baseline)
        const slots = ["fg", "bg", "cursor"] as const
        for (const [index, slot] of slots.entries()) {
          backend.feed(new TextEncoder().encode(`\x1b]${10 + index};rgb:12/34/56\x1b\\`))
          expect(backend.getDefaultColors()).toEqual({ ...baseline, [slot]: { r: 0x12, g: 0x34, b: 0x56 } })
          backend.feed(new TextEncoder().encode(`\x1b]${110 + index}\x1b\\`))
          expect(backend.getDefaultColors()).toEqual(baseline)
        }
      } finally {
        backend.destroy()
      }
      expect(() => backend.getDefaultColors()).toThrow(/not initialized/)
    })

    test("reports blink set and reset on distinct cells", () => {
      const backend = createGhosttyNativeBackend()
      backend.init({ cols: 4, rows: 1 })
      try {
        backend.feed(new TextEncoder().encode("\x1b[5mA\x1b[25mB"))
        expect(backend.getCell(0, 0).blink).toBe(true)
        expect(backend.getCell(0, 1).blink).toBe(false)
      } finally {
        backend.destroy()
      }
    })
  },
)
