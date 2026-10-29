/**
 * @failure Ghostty native readback drops stored URI/style metadata or fabricates unset default colors.
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
        expect(backend.getCell(0, 0)).toMatchObject({ char: "m", hyperlink: null })
        backend.scrollViewport(-1)
        expect(backend.getCell(0, 0)).toMatchObject({ char: "H", hyperlink: uri })
        expect(backend.getHyperlinkAt(0, 0)).toBe(uri)
        expect(backend.getLine(0)[0]).toMatchObject({ char: "H", hyperlink: uri })
        backend.scrollViewport(1)
        expect(backend.getHyperlinkAt(0, 0)).toBeNull()
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
