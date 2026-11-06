/**
 * WezTerm backend unit tests.
 *
 * NOTE: These tests require the native Rust module to be compiled.
 * A missing native module is NOT MEASURED; the deciding native run must have zero skips.
 *
 * Build the native module:
 *   cd packages/wezterm/native && cargo build --release
 *   cp target/release/libtermless_wezterm_native.dylib ../termless-wezterm.node
 * @failure WezTerm loses stored OSC 8 URIs or cannot read real DECCKM state through its native boundary.
 * @level l0
 * @consumer Termless WezTerm backend capability declaration.
 * @testonly none
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest"
import { createWeztermBackend, loadWeztermNative } from "../src/backend.ts"
import * as hostKeyEncoding from "../../../src/terminal/key-encoding.ts"
import type { KeyDescriptor, OscMetadataExtension } from "../../../src/terminal/types.ts"

const encoder = new TextEncoder()
const encode = (s: string) => encoder.encode(s)

let nativeBuildError: string | null = null
try {
  loadWeztermNative()
} catch (error) {
  nativeBuildError = error instanceof Error ? error.message : String(error)
}

describe.skipIf(nativeBuildError !== null)(
  `wezterm backend${nativeBuildError ? ` (NOT MEASURED: ${nativeBuildError})` : ""}`,
  () => {
    let backend: ReturnType<typeof createWeztermBackend>

    // Existing URI/blink tests never observe the distinct stored SGR 58/59 color.
    test("preserves indexed, truecolor and reset underline colors through the cell ABI", () => {
      backend.feed(encode("\x1b[4;38;5;5mC\x1b[58;5;5mI\x1b[58;2;255;0;128mR\x1b[59mD\x1b[0m"))
      const palette5 = { r: 204, g: 85, b: 204 }
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
    })

    beforeEach(() => {
      backend = createWeztermBackend()
      backend.init({ cols: 80, rows: 24 })
    })

    afterEach(() => {
      backend.destroy()
    })

    // Existing cell tests cannot distinguish stored semantic types from the current pen.
    // The bounds check also prevents N-API uint32 coercion aliasing a different cell.
    test("reads stored semantic cells across pen changes and reset without coordinate aliasing", () => {
      backend.feed(encode("\x1b]133;P\x07P\x1b]133;B\x07I\x1b]133;C\x07O"))
      expect([0, 1, 2].map((col) => backend.getCellSemanticType(0, col))).toEqual(["prompt", "input", "output"])
      expect(() => backend.getCellSemanticType(2 ** 32, 0)).toThrow()
      expect(() => backend.getCellSemanticType(0, 2 ** 32)).toThrow()
      backend.reset()
      backend.feed(encode("R"))
      expect(backend.getCell(0, 0).char).toBe("R")
      expect(backend.getCellSemanticType(0, 0)).toBe("output")
    })

    // Existing toast/progress tests do not observe the directory or its native instance boundary.
    test("reads engine-owned Cwd without changing replies or sharing instance state", () => {
      const metadata = backend as typeof backend & Required<Pick<OscMetadataExtension, "getCwd">>
      expect(metadata.getCwd).toBeTypeOf("function")
      const replies: string[] = []
      backend.onResponse = (data) => replies.push(new TextDecoder().decode(data))
      expect(metadata.getCwd()).toBeNull()
      backend.feed(encode("\x1b]7;file://localhost/termless-cwd-A\x07"))
      expect(metadata.getCwd()).toBe("file:///termless-cwd-A")
      backend.feed(encode("\x1b]633;P;Cwd=/ignored-property\x07\x1b]633;A\x07"))
      expect(metadata.getCwd()).toBe("file:///termless-cwd-A")
      backend.feed(encode("\x1b]7;file://otherhost/termless-cwd-B\x07"))
      expect(metadata.getCwd()).toBe("file://otherhost/termless-cwd-B")
      expect(replies).toEqual([])
      backend.feed(encode("\x1b[5n"))
      expect(replies.join("")).toBe("\x1b[0n")

      const other = createWeztermBackend({ cols: 80, rows: 24 }) as typeof metadata
      try {
        expect(other.getCwd()).toBeNull()
        other.feed(encode("\x1b]7;file://localhost/other-instance\x07"))
        expect(other.getCwd()).toBe("file:///other-instance")
        expect(metadata.getCwd()).toBe("file://otherhost/termless-cwd-B")
        backend.feed(encode("\x1b]7;\x07"))
        expect(metadata.getCwd()).toBeNull()
        backend.feed(encode("\x1b]7;file://localhost/before-reinit\x07"))
        backend.init({ cols: 80, rows: 24 })
        expect(metadata.getCwd()).toBeNull()
        expect(other.getCwd()).toBe("file:///other-instance")
        backend.destroy()
        expect(() => metadata.getCwd()).toThrow("not initialized")
      } finally {
        other.destroy()
      }
    })

    // Counter-only tests miss the absolute-row origin once the engine retains primary history.
    test("reads retained physical rows across alternate screens, resize and eviction", () => {
      backend.destroy()
      backend = createWeztermBackend()
      backend.init({ cols: 80, rows: 24, scrollbackLimit: 12 })
      const uri = "https://example.test/retained"
      backend.feed(
        encode(
          Array.from({ length: 36 }, (_, row) => {
            const text = `S${String(row).padStart(2, "0")}`
            return row === 0 || row === 24 ? `\x1b[1m\x1b]8;;${uri}\x1b\\${text}\x1b]8;;\x1b\\\x1b[0m` : text
          }).join("\r\n"),
        ),
      )
      const lineText = (row: number) =>
        backend
          .getLine(row)
          .map((cell) => cell.char)
          .join("")
          .trimEnd()
      expect(backend.getScrollback()).toMatchObject({ totalLines: 36, screenLines: 24 })
      expect(lineText(0)).toBe("S00")
      expect(lineText(12)).toBe("S12")
      expect(backend.getLines()).toHaveLength(36)
      expect(backend.getCell(0, 0)).toMatchObject({ char: "S", bold: true, hyperlink: uri })
      expect(backend.getCell(24, 0)).toMatchObject({ char: "S", bold: true, hyperlink: uri })
      expect(backend.getTextRange(0, 0, 0, 3)).toBe("S00")
      expect(backend.getTextRange(10, 0, 13, 3)).toBe("S10\nS11\nS12\nS13")
      expect(
        backend
          .getText()
          .split("\n")
          .map((line) => line.trimEnd()),
      ).toEqual(Array.from({ length: 36 }, (_, row) => `S${String(row).padStart(2, "0")}`))

      backend.feed(encode("\x1b[?1049h\x1b[1;1HALT"))
      expect(backend.getMode("altScreen")).toBe(true)
      expect(backend.getScrollback()).toMatchObject({ totalLines: 24, screenLines: 24 })
      expect(backend.getLines()).toHaveLength(24)
      expect(lineText(0)).toBe("ALT")
      backend.feed(encode("\x1b[?1049l"))
      expect(backend.getMode("altScreen")).toBe(false)
      expect(backend.getScrollback()).toMatchObject({ totalLines: 36, screenLines: 24 })
      expect(lineText(0)).toBe("S00")
      expect(lineText(12)).toBe("S12")

      backend.resize(60, 24)
      expect(lineText(0)).toBe("S00")
      expect(lineText(12)).toBe("S12")
      backend.feed(encode("\r\nS36"))
      expect(backend.getScrollback()).toMatchObject({ totalLines: 36, screenLines: 24 })
      expect(lineText(0)).toBe("S01")
    })

    // ── Lifecycle ──

    describe("lifecycle", () => {
      test("throws when not initialized", () => {
        const b = createWeztermBackend()
        expect(() => b.getText()).toThrow("not initialized")
      })

      test("re-init clears state", () => {
        backend.feed(encode("hello"))
        backend.init({ cols: 80, rows: 24 })
        expect(backend.getText().trim()).toBe("")
      })

      test("destroy is safe to call multiple times", () => {
        backend.destroy()
        backend.destroy()
      })
    })

    // ── Text I/O ──

    describe("text", () => {
      test("plain text appears at cursor", () => {
        backend.feed(encode("hello"))
        const text = backend.getText()
        expect(text).toContain("hello")
      })

      test("multiline text", () => {
        backend.feed(encode("line1\r\nline2\r\nline3"))
        const text = backend.getText()
        expect(text).toContain("line1")
        expect(text).toContain("line2")
        expect(text).toContain("line3")
      })

      test("CUP positions cursor", () => {
        // CUP: CSI row;col H (1-based)
        backend.feed(encode("\x1b[5;10Htext"))
        const cell = backend.getCell(4, 9) // 0-based
        expect(cell.char).toBe("t")
      })

      test("getTextRange extracts region", () => {
        backend.feed(encode("abcdefghij"))
        const range = backend.getTextRange(0, 0, 0, 5)
        expect(range).toBe("abcde")
      })
    })

    // ── Colors ──

    describe("colors", () => {
      test("truecolor foreground", () => {
        // SGR 38;2;r;g;b
        backend.feed(encode("\x1b[38;2;255;128;0mX"))
        const cell = backend.getCell(0, 0)
        expect(cell.fg).toEqual({ r: 255, g: 128, b: 0 })
      })

      test("truecolor background", () => {
        // SGR 48;2;r;g;b
        backend.feed(encode("\x1b[48;2;0;128;255mX"))
        const cell = backend.getCell(0, 0)
        expect(cell.bg).toEqual({ r: 0, g: 128, b: 255 })
      })

      test("indexed and named colors resolve through the palette, not as {r: index} (#30703)", () => {
        // SGR 38;5;67 is cube (1,2,3) = #5f87af; SGR 48;5;173 is cube (4,2,1) = #d7875f; SGR 31 is palette
        // slot 1, which wezterm's default palette (ColorPalette::compute_default) sets to #cc5555.
        backend.feed(encode("\x1b[38;5;67mA\x1b[0m\x1b[48;5;173mB\x1b[0m\x1b[31mR\x1b[0m"))
        expect(backend.getCell(0, 0).fg).toEqual({ r: 95, g: 135, b: 175 })
        expect(backend.getCell(0, 1).bg).toEqual({ r: 215, g: 135, b: 95 })
        expect(backend.getCell(0, 2).fg).toEqual({ r: 204, g: 85, b: 85 })
      })

      test("default colors are null", () => {
        backend.feed(encode("X"))
        const cell = backend.getCell(0, 0)
        expect(cell.fg).toBeNull()
        expect(cell.bg).toBeNull()
      })

      test("SGR reset clears colors", () => {
        backend.feed(encode("\x1b[38;2;255;0;0mR\x1b[0mX"))
        const red = backend.getCell(0, 0)
        const normal = backend.getCell(0, 1)
        expect(red.fg).toEqual({ r: 255, g: 0, b: 0 })
        expect(normal.fg).toBeNull()
      })
    })

    // ── Attributes ──

    describe("attributes", () => {
      // Existing style cases never observe stored conceal or its independent SGR 28 reset.
      test("preserves conceal set, clear and reset through cell, row and rows readback", () => {
        backend.feed(encode("P\x1b[1;3;4;8;38;2;17;34;51mH\x1b[28mV\x1b[8mI\x1b[0mR"))
        const expectedHidden = [false, true, false, true, false]
        const cells = Array.from({ length: 5 }, (_, col) => backend.getCell(0, col))
        const row = backend.getRow(0).slice(0, 5)
        const rows = backend.getRows()[0]!.slice(0, 5)
        for (const readback of [cells, row, rows]) {
          expect(readback.map((cell) => cell.char).join("")).toBe("PHVIR")
          expect(readback.map((cell) => cell.hidden)).toEqual(expectedHidden)
          for (const cell of readback.slice(1, 4)) {
            expect(cell).toMatchObject({
              bold: true,
              italic: true,
              underline: "single",
              fg: { r: 17, g: 34, b: 51 },
            })
          }
          expect(readback[4]).toMatchObject({ bold: false, italic: false, underline: false, fg: null })
        }
        expect(backend.getCell(99, 99).hidden).toBe(false)
      })

      // An old addon must report its missing field, rather than silently publishing visible cells.
      test("rejects a native row missing conceal metadata with a rebuild instruction", () => {
        const native = loadWeztermNative()
        class StaleCellTerminal extends native.WeztermTerminal {
          override getLine(row: number) {
            return super.getLine(row).map((cell) => {
              Reflect.deleteProperty(cell, "hidden")
              return cell
            })
          }
        }
        const stale = createWeztermBackend({ cols: 12, rows: 3 }, { WeztermTerminal: StaleCellTerminal })
        try {
          expect(() => stale.getRow(0)).toThrow(
            "wezterm native cell.hidden must be a boolean; rebuild the native addon",
          )
        } finally {
          stale.destroy()
        }
      })

      test("reports blink set and reset on distinct cells", () => {
        backend.feed(encode("\x1b[5mA\x1b[25mB"))
        expect(backend.getCell(0, 0).blink).toBe(true)
        expect(backend.getCell(0, 1).blink).toBe(false)
      })

      test("bold", () => {
        backend.feed(encode("\x1b[1mB\x1b[0m"))
        expect(backend.getCell(0, 0).bold).toBe(true)
      })

      test("faint", () => {
        backend.feed(encode("\x1b[2mF\x1b[0m"))
        expect(backend.getCell(0, 0).dim).toBe(true)
      })

      test("italic", () => {
        backend.feed(encode("\x1b[3mI\x1b[0m"))
        expect(backend.getCell(0, 0).italic).toBe(true)
      })

      test("underline (single)", () => {
        backend.feed(encode("\x1b[4mU\x1b[0m"))
        expect(backend.getCell(0, 0).underline).toBe("single")
      })

      test("strikethrough", () => {
        backend.feed(encode("\x1b[9mS\x1b[0m"))
        expect(backend.getCell(0, 0).strikethrough).toBe(true)
      })

      test("inverse", () => {
        backend.feed(encode("\x1b[7mR\x1b[0m"))
        expect(backend.getCell(0, 0).inverse).toBe(true)
      })

      // Existing attribute cases never observe SGR 53/55 overline enable and reset through cell, line and reset readback.
      test("overline enable and reset across cell, line and terminal reset", () => {
        backend.feed(encode("A\x1b[53mB\x1b[55mC\x1b[53mD\x1b[0mE"))
        expect(backend.getCell(0, 0).overline).toBe(false)
        expect(backend.getCell(0, 1).overline).toBe(true)
        expect(backend.getCell(0, 2).overline).toBe(false)
        expect(backend.getCell(0, 3).overline).toBe(true)
        expect(backend.getCell(0, 4).overline).toBe(false)
        expect(
          backend
            .getLine(0)
            .slice(0, 5)
            .map((cell) => cell.overline),
        ).toEqual([false, true, false, true, false])
        expect(backend.getCell(99, 99).overline).toBe(false)
        backend.reset()
        expect(backend.getCell(0, 1).overline).toBe(false)
      })

      test("combined attributes", () => {
        backend.feed(encode("\x1b[1;3;4mX\x1b[0m"))
        const cell = backend.getCell(0, 0)
        expect(cell.bold).toBe(true)
        expect(cell.italic).toBe(true)
        expect(cell.underline).toBe("single")
      })
    })

    // ── Wide characters ──

    describe("hyperlinks", () => {
      test("copies exact stored URIs through cell, row and direct reads, including close and explicit IDs", () => {
        const uri = "https://example.test:8443/a:b?q=c:d"
        const second = "mailto:other@example.test"
        backend.feed(encode(`P\x1b]8;id=display-link;${uri}\x1b\\LINK\x1b]8;;\x1b\\Z`))
        expect(backend.getCell(0, 1).hyperlink).toBe(uri)
        expect(backend.capabilities.osc8Hyperlinks).toBe(true)
        expect(backend.capabilities.extensions?.has("hyperlinks")).toBe(true)
        const row = backend.getRow(0)
        for (const [col, expected] of [
          [0, null],
          [1, uri],
          [4, uri],
          [5, null],
          [6, null],
        ] as const) {
          expect(backend.getCell(0, col).hyperlink).toBe(expected)
          expect(row[col]!.hyperlink).toBe(expected)
          expect(backend.getHyperlinkAt(0, col)).toBe(expected)
        }
        const saved = backend.getCell(0, 1)
        const savedUri = backend.getHyperlinkAt(0, 1)
        backend.feed(encode(`\r\x1b]8;;${second}\x1b\\SECOND\x1b]8;;\x1b\\`))
        expect(backend.getHyperlinkAt(0, 1)).toBe(second)
        expect(saved.hyperlink).toBe(uri)
        expect(savedUri).toBe(uri)
        backend.reset()
        expect(backend.getHyperlinkAt(0, 1)).toBeNull()
        expect(backend.getHyperlinkAt(24, 80)).toBeNull()
      })

      test("uses absolute primary rows after scrollback and preserves wide-column observations", () => {
        backend.init({ cols: 12, rows: 3 })
        const mainUri = "https://main.example.test/"
        const altUri = "https://alt.example.test/"
        backend.feed(encode(`old0\r\nold1\r\nold2\r\n\x1b]8;;${mainUri}\x1b\\M\x1b]8;;\x1b\\`))
        const mainState = backend.getScrollback()
        expect(mainState.totalLines).toBeGreaterThan(3)
        const mainRow = mainState.totalLines - mainState.screenLines + 2
        expect(backend.getCell(0, 0).char).toBe("o")
        expect(backend.getHyperlinkAt(0, 0)).toBeNull()
        expect(backend.getCell(mainRow, 0).char).toBe("M")
        expect(backend.getRow(mainRow)[0]!.hyperlink).toBe(mainUri)
        expect(backend.getHyperlinkAt(mainRow, 0)).toBe(mainUri)
        backend.feed(encode(`\x1b[?1049hX\x1b]8;;${altUri}\x1b\\你\x1b]8;;\x1b\\Z`))
        expect(backend.getMode("altScreen")).toBe(true)
        expect(backend.getCell(0, 1)).toMatchObject({ char: "你", wide: true, hyperlink: altUri })
        // The actual WezTerm cell reader has no cell at a wide glyph's continuation column.
        expect(backend.getCell(0, 2)).toMatchObject({ char: "", hyperlink: null })
        for (const [col, expected] of [
          [0, null],
          [1, altUri],
          [2, null],
          [3, null],
        ] as const) {
          expect(backend.getRow(0)[col]!.hyperlink).toBe(expected)
          expect(backend.getHyperlinkAt(0, col)).toBe(expected)
        }
        backend.feed(encode("\x1b[?1049l"))
        expect(backend.getMode("altScreen")).toBe(false)
        expect(backend.getScrollback().totalLines).toBe(mainState.totalLines)
        expect(backend.getCell(mainRow, 0).char).toBe("M")
        expect(backend.getHyperlinkAt(mainRow, 0)).toBe(mainUri)
      })

      test.each([undefined, 42])("rejects missing or invalid native URI metadata (%s)", (hyperlink) => {
        const native = loadWeztermNative()
        class InvalidCellTerminal extends native.WeztermTerminal {
          override getCell(row: number, col: number) {
            const cell = super.getCell(row, col)
            Reflect.set(cell, "hyperlink", hyperlink)
            return cell
          }
          override getLine(row: number) {
            return super.getLine(row).map((cell) => {
              Reflect.set(cell, "hyperlink", hyperlink)
              return cell
            })
          }
        }
        const faulty = createWeztermBackend({ cols: 12, rows: 3 }, { WeztermTerminal: InvalidCellTerminal })
        try {
          expect(() => faulty.getCell(0, 0)).toThrow("wezterm native cell.hyperlink must be a string or null")
          expect(() => faulty.getRow(0)).toThrow("wezterm native cell.hyperlink must be a string or null")
          expect(() => faulty.getHyperlinkAt(0, 0)).toThrow("wezterm native cell.hyperlink must be a string or null")
        } finally {
          faulty.destroy()
        }
      })
    })

    describe("wide characters", () => {
      test("CJK character is wide", () => {
        backend.feed(encode("你"))
        const cell = backend.getCell(0, 0)
        expect(cell.char).toBe("你")
        expect(cell.wide).toBe(true)
      })
    })

    // ── Cursor ──

    describe("cursor", () => {
      test("initial position", () => {
        const cursor = backend.getCursor()
        expect(cursor.x).toBe(0)
        expect(cursor.y).toBe(0)
      })

      test("advances with text", () => {
        backend.feed(encode("abc"))
        const cursor = backend.getCursor()
        expect(cursor.x).toBe(3)
        expect(cursor.y).toBe(0)
      })

      test("newline moves to next row", () => {
        backend.feed(encode("abc\r\n"))
        const cursor = backend.getCursor()
        expect(cursor.x).toBe(0)
        expect(cursor.y).toBe(1)
      })

      test("CUP sets position", () => {
        backend.feed(encode("\x1b[10;20H"))
        const cursor = backend.getCursor()
        expect(cursor.x).toBe(19) // 0-based
        expect(cursor.y).toBe(9) // 0-based
      })
    })

    // ── Modes ──

    describe("modes", () => {
      test("alt screen off by default", () => {
        expect(backend.getMode("altScreen")).toBe(false)
      })

      test("alt screen on after DECSET 1049", () => {
        backend.feed(encode("\x1b[?1049h"))
        expect(backend.getMode("altScreen")).toBe(true)
      })

      test("alt screen off after DECRST 1049", () => {
        backend.feed(encode("\x1b[?1049h"))
        backend.feed(encode("\x1b[?1049l"))
        expect(backend.getMode("altScreen")).toBe(false)
      })

      test("bracketed paste off by default", () => {
        expect(backend.getMode("bracketedPaste")).toBe(false)
      })

      test("bracketed paste on after DECSET 2004", () => {
        backend.feed(encode("\x1b[?2004h"))
        expect(backend.getMode("bracketedPaste")).toBe(true)
      })

      // Existing mode tests require null, so they miss delivery of the real engine DECCKM getter.
      test("reads application cursor state through fragmented set, reset, DECSTR, RIS and isolated instances", () => {
        const other = createWeztermBackend()
        other.init({ cols: 80, rows: 24 })
        try {
          expect(backend.getMode("applicationCursor")).toBe(false)
          expect(other.getMode("applicationCursor")).toBe(false)
          backend.feed(encode("\x1b[?"))
          expect(backend.getMode("applicationCursor")).toBe(false)
          backend.feed(encode("1"))
          expect(backend.getMode("applicationCursor")).toBe(false)
          backend.feed(encode("h"))
          expect(backend.getMode("applicationCursor")).toBe(true)
          expect(other.getMode("applicationCursor")).toBe(false)
          for (const [bytes, enabled] of [
            ["\x1b[?1l", false],
            ["\x1b[?1h", true],
            ["\x1b[!p", false],
          ] as const) {
            backend.feed(encode(bytes))
            expect(backend.getMode("applicationCursor"), JSON.stringify(bytes)).toBe(enabled)
            expect(other.getMode("applicationCursor")).toBe(false)
          }
          backend.feed(encode("\x1b[?1h"))
          other.feed(encode("\x1b[?1h"))
          expect(backend.getMode("applicationCursor")).toBe(true)
          expect(other.getMode("applicationCursor")).toBe(true)
          backend.feed(encode("\x1bc"))
          expect(backend.getMode("applicationCursor")).toBe(false)
          expect(other.getMode("applicationCursor")).toBe(true)
        } finally {
          other.destroy()
        }
      })

      test("returns null for modes without public wezterm-term getters instead of scanner shadow state", () => {
        backend.feed(encode("\x1b[?1h\x1b[?6h\x1b[?7l\x1b[?66h\x1b[?1004h\x1b[4h"))
        for (const mode of ["applicationKeypad", "autoWrap", "focusTracking", "originMode", "insertMode"] as const) {
          expect(backend.getMode(mode), `expected null for unobserved mode ${mode}`).toBeNull()
        }
        expect(backend.getMode("sgrMouse" as never)).toBeNull()
      })
    })

    describe("responses", () => {
      test("forwards DECRPM and DA1/DSR engine responses synchronously through onResponse", () => {
        const responses: string[] = []
        backend.onResponse = (bytes) => responses.push(new TextDecoder().decode(bytes))

        backend.feed(encode("\x1b[?2004h\x1b[?2004$p"))
        backend.feed(encode("\x1b[?2004l\x1b[?2004$p"))
        backend.feed(encode("\x1b[?1006h\x1b[?1006$p"))
        backend.feed(encode("\x1b[5n"))

        expect(responses).toEqual(["\x1b[?2004;1$y", "\x1b[?2004;2$y", "\x1b[?1006;1$y", "\x1b[0n"])
      })
    })

    // Mode getters cannot prove native input encoding or separation from protocol replies.
    describe("paste encoding", () => {
      test("encodes native paste through off/on/off without rendering or dispatching replies", () => {
        const responses: Uint8Array[] = []
        backend.onResponse = (bytes) => responses.push(bytes)
        expect(backend.capabilities.extensions?.has("paste-encoding")).toBe(true)
        const text = "paste-32310 λ🙂"
        const screen = backend.getText()
        const cursor = backend.getCursor()
        for (const [mode, enabled] of [
          ["\x1b[?2004l", false],
          ["\x1b[?2004h", true],
          ["\x1b[?2004l", false],
        ] as const) {
          backend.feed(encode(mode))
          expect(backend.encodePaste(text)).toEqual(encode(enabled ? `\x1b[200~${text}\x1b[201~` : text))
          expect(backend.encodePaste("")).toEqual(encode(enabled ? "\x1b[200~\x1b[201~" : ""))
          expect(backend.getMode("bracketedPaste")).toBe(enabled)
          expect(backend.getText()).toBe(screen)
          expect(backend.getCursor()).toEqual(cursor)
        }
        backend.feed(encode("\x1b[5n"))
        expect(responses).toEqual([encode("\x1b[0n")])
      })

      test("preserves pending native replies in order and excludes paste bytes from the next read", () => {
        // backend.feed drains replies, so use the same native boundary before its response read.
        const native = new (loadWeztermNative().WeztermTerminal)(80, 24)
        native.feed(Buffer.from("\x1b[5n\x1b[?2004h\x1b[?2004$p"))
        expect(native.encodePaste("queued-prefix λ🙂")).toEqual(Buffer.from("\x1b[200~queued-prefix λ🙂\x1b[201~"))
        native.feed(Buffer.from("\x1b[?2004l\x1b[?2004$p"))
        expect(native.readResponse()).toEqual(Buffer.from("\x1b[0n\x1b[?2004;1$y\x1b[?2004;2$y"))
        expect(native.readResponse()).toBeNull()
      })

      test("requires initialization and observes fresh mode state after re-init", () => {
        const local = createWeztermBackend()
        expect(() => local.encodePaste("before init")).toThrow("not initialized")
        local.init({ cols: 80, rows: 24 })
        try {
          local.feed(encode("\x1b[?2004h"))
          expect(local.encodePaste("first")).toEqual(encode("\x1b[200~first\x1b[201~"))
          local.init({ cols: 80, rows: 24 })
          expect(local.encodePaste("fresh")).toEqual(encode("fresh"))
        } finally {
          local.destroy()
        }
        expect(() => local.encodePaste("after destroy")).toThrow("not initialized")
      })
    })

    // @failure Mouse input is host-encoded, invents a press before a drag, or changes screen/reply state.
    // @level l5
    // @consumer Real WezTerm native mouse encoder through the public backend.
    describe("mouse encoding", () => {
      test("forwards native buttons, actions and modifiers without inventing input", () => {
        const event = { x: 4, y: 2, button: "left", action: "press" } as const
        const screen = backend.getText()
        const cursor = backend.getCursor()
        expect(backend.encodeMouse(event)).toBeNull()
        expect(backend.encodeMouse({ ...event, action: "release" })).toBeNull()
        backend.feed(encode("\x1b[?1002;1006h"))
        expect(backend.encodeMouse({ ...event, action: "move" })).toBeNull()
        expect(backend.encodeMouse(event)).toEqual(encode("\x1b[<0;5;3M"))
        expect(backend.encodeMouse({ ...event, action: "move" })).toEqual(encode("\x1b[<32;5;3M"))
        expect(backend.encodeMouse({ ...event, action: "move", button: "none", x: 5 })).toEqual(encode("\x1b[<32;6;3M"))
        expect(backend.encodeMouse({ ...event, action: "release" })).toEqual(encode("\x1b[<0;5;3m"))
        for (const [button, report] of [
          ["left", "\x1b[<0;5;3M"],
          ["middle", "\x1b[<1;5;3M"],
          ["right", "\x1b[<2;5;3M"],
          ["wheelUp", "\x1b[<64;5;3M"],
          ["wheelDown", "\x1b[<65;5;3M"],
        ] as const) {
          expect(backend.encodeMouse({ ...event, button }), button).toEqual(encode(report))
        }
        expect(backend.encodeMouse({ ...event, button: "none" })).toBeNull()
        expect(backend.encodeMouse({ ...event, shift: true, ctrl: true, alt: true })).toEqual(encode("\x1b[<28;5;3M"))
        expect(() => backend.encodeMouse({ ...event, pixel: { x: 40, y: 24 } })).toThrow(
          "mouse encoding unavailable: WezTerm pixel-coordinate path is not bound",
        )
        expect(backend.getText()).toBe(screen)
        expect(backend.getCursor()).toEqual(cursor)
      })

      test("keeps a queued native DSR reply out of mouse bytes and delivers it once", () => {
        const native = new (loadWeztermNative().WeztermTerminal)(80, 24)
        native.feed(Buffer.from("\x1b[5n\x1b[?1000;1006h"))
        expect(native.encodeMouse(4, 2, "left", "press", false, false, false)).toEqual(Buffer.from("\x1b[<0;5;3M"))
        expect(native.readResponse()).toEqual(Buffer.from("\x1b[0n"))
        expect(native.readResponse()).toBeNull()
      })
    })

    // ── Key encoding ──

    describe("key encoding", () => {
      test("Enter", () => {
        expect(backend.encodeKey({ key: "Enter" })).toEqual(encode("\r"))
      })

      test("Escape", () => {
        expect(backend.encodeKey({ key: "Escape" })).toEqual(encode("\x1b"))
      })

      test("Ctrl+C", () => {
        expect(backend.encodeKey({ key: "c", ctrl: true })).toEqual(new Uint8Array([3]))
      })

      // Default-byte checks cannot distinguish the host shim from this engine's current mode.
      test("ArrowUp follows the same engine's DECCKM off/on/off state", () => {
        expect(backend.capabilities.extensions.has("key-encoding")).toBe(true)
        for (const [mode, enabled, expected] of [
          ["\x1b[?1l", false, "\x1b[A"],
          ["\x1b[?1h", true, "\x1bOA"],
          ["\x1b[?1l", false, "\x1b[A"],
        ] as const) {
          backend.feed(encode(mode))
          expect(backend.getMode("applicationCursor")).toBe(enabled)
          expect(backend.encodeKey({ key: "ArrowUp" })).toEqual(encode(expected))
        }
      })

      test("regular character", () => {
        expect(backend.encodeKey({ key: "a" })).toEqual(encode("a"))
      })

      test("Shift+ArrowUp", () => {
        expect(backend.encodeKey({ key: "ArrowUp", shift: true })).toEqual(encode("\x1b[1;2A"))
      })

      test("Alt+letter", () => {
        expect(backend.encodeKey({ key: "x", alt: true })).toEqual(encode("\x1bx"))
      })

      // Matching bytes alone miss host encoding; the existing constructor seam observes real native calls.
      test("delegates the shared named keys and one scalar to the native instance", () => {
        const native = loadWeztermNative()
        const calls: [string, boolean, boolean, boolean, boolean][] = []
        class ObservedTerminal extends native.WeztermTerminal {
          override encodeKey(key: string, shift: boolean, ctrl: boolean, alt: boolean, superKey: boolean): Buffer {
            calls.push([key, shift, ctrl, alt, superKey])
            return super.encodeKey(key, shift, ctrl, alt, superKey)
          }
        }
        const local = createWeztermBackend({ cols: 80, rows: 24 }, { WeztermTerminal: ObservedTerminal })
        const host = vi.spyOn(hostKeyEncoding, "encodeKeyToAnsi")
        try {
          const descriptors: KeyDescriptor[] = [
            ...[
              "ArrowUp",
              "ArrowDown",
              "ArrowLeft",
              "ArrowRight",
              "Home",
              "End",
              "PageUp",
              "PageDown",
              "Enter",
              "Tab",
              "Backspace",
              "Delete",
              "Escape",
              "Space",
              "Control",
              "Shift",
              "Alt",
              "Meta",
              ...Array.from({ length: 24 }, (_, index) => `F${index + 1}`),
              "é",
              "🦊",
            ].map((key) => ({ key })),
            { key: "a", shift: true, ctrl: true, alt: true, super: true },
          ]
          for (const descriptor of descriptors) {
            calls.length = 0
            expect(local.encodeKey(descriptor)).toBeInstanceOf(Uint8Array)
            expect(calls).toEqual([
              [descriptor.key, !!descriptor.shift, !!descriptor.ctrl, !!descriptor.alt, !!descriptor.super],
            ])
          }
          for (const key of ["Control", "Shift", "Alt", "Meta"]) {
            expect(local.encodeKey({ key })).toEqual(new Uint8Array())
          }
          expect(host).not.toHaveBeenCalled()
        } finally {
          host.mockRestore()
          local.destroy()
        }
      })

      test("rejects unknown names and multi-scalar descriptors before touching queued replies", () => {
        // N-API converts malformed UTF-16 to replacement text before Rust sees it.
        for (const key of ["\uD800", "\uDC00", "a\uD800"]) {
          expect(() => backend.encodeKey({ key })).toThrow(/Unicode scalar/)
        }
        const native = new (loadWeztermNative().WeztermTerminal)(80, 24)
        native.feed(Buffer.from("\x1b[5n"))
        for (const key of ["", "hello", "UnknownKey", "F0", "F25", "F01", "🦊a"]) {
          expect(() => native.encodeKey(key, false, false, false, false)).toThrow(/wezterm.*no native encoding/)
        }
        expect(() => native.encodeKey("ab", false, true, false, false)).toThrow(/wezterm.*no native encoding/)
        expect(native.readResponse()).toEqual(Buffer.from("\x1b[0n"))
        expect(native.readResponse()).toBeNull()
      })

      test("keeps native key bytes separate from pending replies and screen state", () => {
        const native = new (loadWeztermNative().WeztermTerminal)(80, 24)
        native.feed(Buffer.from("\x1b[5n\x1b[?1h\x1b[?1$p"))
        expect(native.encodeKey("ArrowUp", false, false, false, false)).toEqual(Buffer.from("\x1bOA"))
        expect(native.readResponse()).toEqual(Buffer.from("\x1b[0n\x1b[?1;1$y"))
        expect(native.readResponse()).toBeNull()
        const replies: Uint8Array[] = []
        backend.onResponse = (bytes) => replies.push(bytes)
        const before = { screen: backend.getText(), cursor: backend.getCursor() }
        backend.encodeKey({ key: "a" })
        expect(replies).toEqual([])
        expect({ screen: backend.getText(), cursor: backend.getCursor() }).toEqual(before)
        backend.feed(encode("\x1b[6n"))
        expect(replies).toEqual([encode("\x1b[1;1R")])
      })

      test("requires initialization and fresh mode state after re-init", () => {
        const local = createWeztermBackend()
        expect(() => local.encodeKey({ key: "ArrowUp" })).toThrow("not initialized")
        local.init({ cols: 80, rows: 24 })
        try {
          local.feed(encode("\x1b[?1h"))
          expect(local.encodeKey({ key: "ArrowUp" })).toEqual(encode("\x1bOA"))
          local.init({ cols: 80, rows: 24 })
          expect(local.encodeKey({ key: "ArrowUp" })).toEqual(encode("\x1b[A"))
        } finally {
          local.destroy()
        }
        expect(() => local.encodeKey({ key: "ArrowUp" })).toThrow("not initialized")
      })

      test("propagates a native boundary error and encodes on a fresh instance", () => {
        const native = loadWeztermNative()
        const failure = new Error("injected native key boundary failure")
        class FailedTerminal extends native.WeztermTerminal {
          override encodeKey(key: string, shift: boolean, ctrl: boolean, alt: boolean, superKey: boolean): Buffer {
            super.encodeKey(key, shift, ctrl, alt, superKey)
            throw failure
          }
        }
        const failed = createWeztermBackend({ cols: 80, rows: 24 }, { WeztermTerminal: FailedTerminal })
        try {
          expect(() => failed.encodeKey({ key: "ArrowUp" })).toThrow(failure)
        } finally {
          // An error after the boundary requires destroy, never same-instance retry.
          failed.destroy()
        }
        const fresh = createWeztermBackend({ cols: 80, rows: 24 })
        try {
          expect(fresh.encodeKey({ key: "ArrowUp" })).toEqual(encode("\x1b[A"))
        } finally {
          fresh.destroy()
        }
      })

      test("names the rebuild command when the native method is missing", () => {
        const native = loadWeztermNative()
        class StaleTerminal extends native.WeztermTerminal {}
        Object.defineProperty(StaleTerminal.prototype, "encodeKey", { value: undefined })
        const stale = createWeztermBackend({ cols: 80, rows: 24 }, { WeztermTerminal: StaleTerminal })
        try {
          expect(() => stale.encodeKey({ key: "ArrowUp" })).toThrow(/predates encodeKey.*rebuild and copy/)
        } finally {
          stale.destroy()
        }
      })
    })

    // ── Scrollback ──

    describe("scrollback", () => {
      test("initial scrollback state", () => {
        const sb = backend.getScrollback()
        expect(sb.screenLines).toBe(24)
        expect(sb.totalLines).toBeGreaterThanOrEqual(24)
      })

      test("scrollback grows beyond screen", () => {
        // Write enough lines to overflow
        for (let i = 0; i < 30; i++) {
          backend.feed(encode(`line ${i}\r\n`))
        }
        const sb = backend.getScrollback()
        expect(sb.totalLines).toBeGreaterThan(24)
      })

      // Existing tests above observe totals only, never the absolute buffer row the
      // contract defines, so a bottom-relative 0 passed off as an absolute row stays green.
      test("reports the absolute viewport row at the live bottom", () => {
        const local = createWeztermBackend({ cols: 20, rows: 3 })
        try {
          expect(local.getScrollback()).toEqual({
            viewportTop: 0,
            totalRows: 3,
            screenRows: 3,
            viewportOffset: 0,
            totalLines: 3,
            screenLines: 3,
          })
          local.feed(encode("0\r\n1\r\n2\r\n3\r\n4\r\n5\r\n6\r\n7"))
          // Eight rows of history over a three-row screen: at the live bottom the
          // absolute start row is 5, not 0. WezTerm's headless fork has no viewport
          // scroll state, so scrollViewport is a no-op and the row must not move.
          expect(local.getScrollback()).toEqual({
            viewportTop: 5,
            totalRows: 8,
            screenRows: 3,
            viewportOffset: 5,
            totalLines: 8,
            screenLines: 3,
          })
          local.scrollViewport(-2)
          expect(local.getScrollback().viewportTop).toBe(5)
        } finally {
          local.destroy()
        }
      })
    })

    // ── Resize ──

    describe("resize", () => {
      test("resize changes dimensions", () => {
        backend.resize(40, 12)
        backend.feed(encode("hello"))
        // Should not crash and cursor should be within new bounds
        const cursor = backend.getCursor()
        expect(cursor.x).toBe(5)
      })
    })

    // ── Reset ──

    describe("reset", () => {
      test("clears screen", () => {
        backend.feed(encode("hello"))
        backend.reset()
        const text = backend.getText()
        expect(text.trim()).toBe("")
      })

      // Reset must clear engine state too: a cache-only clear resurrects titles on the next feed.
      test("clears independent titles through the next feed", () => {
        backend.feed(encode("\x1b]2;My Title\x07\x1b]1;My Icon\x07"))
        expect(backend.getTitle()).toBe("My Title")
        expect(backend.getIconLabel?.()).toBe("My Icon")
        backend.reset()
        backend.feed(encode("x"))
        expect(backend.getTitle()).toBe("")
        expect(backend.getIconLabel?.()).toBe("")
      })
    })

    // ── Title ──

    describe("title", () => {
      // OSC2-only tests miss the engine effective-title getter collapsing OSC1 and OSC2.
      test("OSC 0/1/2 retain independent UTF-8, empty and instance-local titles", () => {
        backend.feed(encode("\x1b]2;actual-window\x07\x1b]1;actual-icon\x07"))
        expect(backend.getTitle()).toBe("actual-window")
        expect(backend.getIconLabel?.()).toBe("actual-icon")
        backend.feed(encode("\x1b]2;窓 é\x1b\\"))
        expect(backend.getTitle()).toBe("窓 é")
        expect(backend.getIconLabel?.()).toBe("actual-icon")
        backend.feed(encode("\x1b]1;\x07"))
        expect(backend.getIconLabel?.()).toBe("")
        expect(backend.getTitle()).toBe("窓 é")
        backend.feed(encode("\x1b]0;shared 窓\x07"))
        expect(backend.getTitle()).toBe("shared 窓")
        expect(backend.getIconLabel?.()).toBe("shared 窓")
        const other = createWeztermBackend()
        other.init({ cols: 30, rows: 4 })
        try {
          expect(other.getTitle()).toBe("")
          expect(other.getIconLabel?.()).toBe("")
        } finally {
          other.destroy()
        }
      })
    })

    // Accepted #32288: observe the engine current state through the existing progress API.
    // Toast tests never read progress; a missing bridge or stale/constant projection must fail here.
    test("reads stored progress transitions without inventing report history or changing toasts", () => {
      const metadata: OscMetadataExtension = backend
      expect(typeof metadata.getProgress).toBe("function")
      const read = () => metadata.getProgress!()
      expect(read()).toEqual({ state: 0, value: null })
      const toasts = backend.getToasts()
      for (const [sequence, expected] of [
        ["\x1b]9;4;1;17\x07", { state: 1, value: 17 }],
        ["\x1b]9;4;1;83\x1b\\", { state: 1, value: 83 }],
        ["\x1b]9;4;2;29\x07", { state: 2, value: 29 }],
        ["\x1b]9;4;3\x07", { state: 3, value: null }],
        ["\x1b]9;4;0\x07", { state: 0, value: null }],
        ["\x1b]9;4;1;61\x07", { state: 1, value: 61 }],
        ["\x1b]9;4;4\x07", { state: 0, value: null }],
      ] as const) {
        backend.feed(encode(sequence))
        expect(read(), sequence).toEqual(expected)
        expect(read(), "reader must not mutate state").toEqual(expected)
      }
      expect(backend.getToasts()).toEqual(toasts)
      backend.init({ cols: 30, rows: 4 })
      expect(read()).toEqual({ state: 0, value: null })
      backend.destroy()
      expect(read).toThrow("not initialized")
    })

    // ── Toasts ──

    describe("toasts", () => {
      /**
       * @failure #32272: WezTerm emits every OSC 9 and OSC 777 notify as Alert::ToastNotification (fork.5
       * terminal.rs:49-57), but the embedding's notification handler dropped it (lib.rs `_ => {}`), so no reader saw
       * the toasts WezTerm parsed.
       * @consumer Terminfo extensions.notifications and extensions.osc777-notify through osc-metadata getToasts
       */
      test("stores every engine-emitted toast verbatim and in order; init empties it", () => {
        expect(backend.capabilities.extensions.has("osc-metadata")).toBe(true)
        expect(backend.getToasts()).toEqual([])
        // Non-toast sequences of both families store nothing: ConEmu progress, and an rxvt extension other than notify.
        backend.feed(encode("\x1b]9;4;0\x07\x1b]777;preexec\x07"))
        expect(backend.getToasts()).toEqual([])
        backend.feed(encode("\x1b]9;nine body\x07"))
        backend.feed(encode("\x1b]777;notify;T777;B777\x1b\\"))
        // A 777 notify without a body reports its only field as the body and no title (performer.rs:918-933).
        backend.feed(encode("\x1b]777;notify;lonely\x07X"))
        // OSC 9 reports no title (performer.rs:904-911): null, never an invented "".
        const toasts = backend.getToasts()
        expect(toasts).toEqual([
          { title: null, body: "nine body" },
          { title: "T777", body: "B777" },
          { title: null, body: "lonely" },
        ])
        toasts[0]!.body = "mutated"
        // The type is readonly; the runtime array is a copy the caller may change without touching the store.
        ;(toasts as { title: string | null; body: string }[]).pop()
        expect(backend.getToasts()).toHaveLength(3)
        expect(backend.getToasts()[0]).toEqual({ title: null, body: "nine body" })
        expect(backend.getCell(0, 0).char).toBe("X")
        backend.init({ cols: 30, rows: 4 })
        expect(backend.getToasts()).toEqual([])
        backend.destroy()
        expect(() => backend.getToasts()).toThrow("not initialized")
      })
    })

    // ── Capabilities ──

    describe("capabilities", () => {
      test("name is wezterm", () => {
        expect(backend.capabilities.name).toBe("wezterm")
      })

      test("supports truecolor", () => {
        expect(backend.capabilities.truecolor).toBe(true)
      })

      test("supports kitty keyboard", () => {
        expect(backend.capabilities.kittyKeyboard).toBe(true)
      })

      test("supports sixel", () => {
        expect(backend.capabilities.sixel).toBe(true)
      })

      test("supports reflow", () => {
        expect(backend.capabilities.reflow).toBe(true)
      })
    })

    // ── getLine / getLines ──

    describe("line access", () => {
      test("getLine returns correct number of cells", () => {
        backend.feed(encode("abc"))
        const line = backend.getLine(0)
        expect(line.length).toBe(80)
        expect(line[0]!.char).toBe("a")
        expect(line[1]!.char).toBe("b")
        expect(line[2]!.char).toBe("c")
      })

      test("getLines returns correct number of rows", () => {
        const lines = backend.getLines()
        expect(lines.length).toBe(24)
      })
    })
  },
)
