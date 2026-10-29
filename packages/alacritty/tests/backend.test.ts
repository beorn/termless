/**
 * Alacritty backend tests -- napi-rs headless terminal emulation.
 *
 * Tests the Alacritty backend implementation using alacritty_terminal via napi-rs.
 * These mirror the xterm.js and Ghostty backend tests for cross-backend compatibility.
 *
 * TODO: Tests require the native Rust module to be built first.
 * Run: cd packages/alacritty/native && cargo build --release
 * @failure Audited native reply delivery is omitted or binds different adapter/glue/loader bytes.
 * @level l0
 * @consumer Headless collector native reply eligibility.
 * @testonly none
 */
import { describe, test, expect, afterEach, vi } from "vitest"
import { createAlacrittyBackend, loadAlacrittyNative } from "../src/backend.ts"
import type { TerminalBackend } from "../../../src/terminal/types.ts"
import { hasExtension, type HyperlinkExtension, type ReplyDeliveryExtension } from "../../../src/terminal/types.ts"
import { createHash } from "node:crypto"
import { readFileSync, realpathSync } from "node:fs"
import { relative } from "node:path"
import { fileURLToPath } from "node:url"

// N1/N2: declaration integrity is independent of addon availability; no init/feed is performed.
// Existing native behavior tests cannot detect a missing or stale source binding when builds are absent.
test("declares audited native reply delivery without initializing the engine", () => {
  const backend = createAlacrittyBackend()
  expect(hasExtension(backend, "reply-delivery")).toBe(true)
  if (!hasExtension<ReplyDeliveryExtension>(backend, "reply-delivery")) {
    throw new Error("Alacritty declares no reply delivery")
  }
  expect(backend.replyDelivery.engine).toEqual({
    kind: "native",
    sha256: "32d76284e5a3c7673fafbbc83a16717fa0a1c1811c7d659d982176a53ceb1aa9",
  })
  expect(backend.replyDelivery.boundary).toBe("feed-and-getCursor")
  const repo = fileURLToPath(new URL("../../../", import.meta.url))
  const sources = ["../src/index.ts", "../src/backend.ts", "../native/src/lib.rs", "../../../src/load-native.ts"]
  expect(backend.replyDelivery.adapterSources).toEqual(
    sources.map((path) => {
      const target = realpathSync(fileURLToPath(new URL(path, import.meta.url)))
      const bytes = readFileSync(target)
      return {
        path: relative(repo, target).replaceAll("\\", "/"),
        blobOid: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
      }
    }),
  )
  backend.destroy()
})

// Native coverage is optional in the default suite; an absent addon is NOT MEASURED.
let nativeAvailable = false
let nativeUnavailableReason = ""
try {
  loadAlacrittyNative()
  nativeAvailable = true
} catch (error) {
  nativeUnavailableReason = error instanceof Error ? error.message : String(error)
}

const describeNative = nativeAvailable ? describe : describe.skip

function createBackend(cols = 80, rows = 24): TerminalBackend {
  const backend = createAlacrittyBackend()
  backend.init({ cols, rows })
  return backend
}

function feedText(backend: TerminalBackend, text: string): void {
  backend.feed(new TextEncoder().encode(text))
}

// Existing style tests cannot detect dropped OSC 8 metadata or concealed native read failures.
describeNative(
  nativeAvailable
    ? "alacritty hyperlink observations"
    : `alacritty hyperlink observations (NOT MEASURED: ${nativeUnavailableReason})`,
  () => {
    test("reads owned OSC 8 URIs consistently across cells, rows and active buffers", () => {
      const backend = createBackend(40, 4)
      const first = "https://example.test:8443/a:b"
      const second = "urn:example:second"
      function expectLink(row: number, col: number, char: string, uri: string | null): void {
        expect(backend.getCell(row, col)).toMatchObject({ char, hyperlink: uri })
        expect(backend.getLine(row)[col]).toMatchObject({ char, hyperlink: uri })
        expect(backend.getLines()[row]![col]).toMatchObject({ char, hyperlink: uri })
        expect(hasExtension(backend, "hyperlinks")).toBe(true)
        if (!hasExtension<HyperlinkExtension>(backend, "hyperlinks")) throw new Error("Missing hyperlinks extension")
        expect(backend.getHyperlinkAt(row, col)).toBe(uri)
      }
      try {
        feedText(backend, `A\x1b]8;id=not-the-uri;${first}\x1b\\LINK\x1b]8;;\x1b\\Z`)
        expectLink(0, 1, "L", first)
        expectLink(0, 4, "K", first)
        expectLink(0, 0, "A", null)
        expectLink(0, 5, "Z", null)
        expectLink(3, 0, " ", null)
        const saved = backend.getCell(0, 1).hyperlink

        feedText(backend, `\x1b[?1049h\x1b[HB\x1b]8;;${second}\x1b\\ALT\x1b]8;;\x1b\\Q`)
        expectLink(0, 1, "A", second)
        expectLink(0, 0, "B", null)
        expectLink(0, 4, "Q", null)
        feedText(backend, "\x1b[?1049l")
        expectLink(0, 1, "L", first)

        feedText(backend, `\x1b[2;4r\x1b[?6h\x1b[1;1H\x1b]8;;${second}\x1b\\R\x1b]8;;\x1b\\S`)
        expectLink(1, 0, "R", second)
        expectLink(1, 1, "S", null)
        expectLink(0, 1, "L", first)
        feedText(backend, "\x1b[?6l\x1b[r\x1b[H\x1b[2Kplain")
        expectLink(0, 1, "l", null)
        expect(saved).toBe(first)
      } finally {
        backend.destroy()
      }
    })

    test("propagates native read failures and rejects missing or malformed URI metadata", () => {
      const native = loadAlacrittyNative()
      const backend = createBackend(10, 2)
      const prototype = native.AlacrittyTerminal.prototype
      try {
        const cell = new native.AlacrittyTerminal(10, 2)
        let original: ReturnType<typeof cell.getCell>
        try {
          original = cell.getCell(0, 0)
        } finally {
          cell.destroy()
        }
        const readHyperlink = () => {
          if (!hasExtension<HyperlinkExtension>(backend, "hyperlinks")) throw new Error("Missing hyperlinks extension")
          return backend.getHyperlinkAt(0, 0)
        }
        const reads = [() => backend.getCell(0, 0), () => backend.getLine(0), () => backend.getLines(), readHyperlink]
        for (const invalid of [undefined, 42, {}]) {
          const broken = { ...original }
          if (invalid === undefined) Reflect.deleteProperty(broken, "hyperlink")
          else Reflect.set(broken, "hyperlink", invalid)
          const spies = [
            vi.spyOn(prototype, "getCell").mockReturnValue(broken),
            vi.spyOn(prototype, "getLine").mockReturnValue([broken]),
            vi.spyOn(prototype, "getLines").mockReturnValue([[broken]]),
          ]
          try {
            for (const read of reads) expect(read).toThrow(/hyperlink/)
          } finally {
            for (const spy of spies) spy.mockRestore()
          }
        }
        const failure = new Error("native read failed")
        const fail = () => {
          throw failure
        }
        const spies = [
          vi.spyOn(prototype, "getCell").mockImplementation(fail),
          vi.spyOn(prototype, "getLine").mockImplementation(fail),
          vi.spyOn(prototype, "getLines").mockImplementation(fail),
        ]
        try {
          for (const read of reads) expect(read).toThrow(failure)
        } finally {
          for (const spy of spies) spy.mockRestore()
        }
      } finally {
        backend.destroy()
      }
    })
  },
)

describeNative("alacritty backend", () => {
  let backend: TerminalBackend

  afterEach(() => {
    if (backend) backend.destroy()
  })

  describe("lifecycle", () => {
    test("creates with correct name", () => {
      backend = createBackend()
      expect(backend.name).toBe("alacritty")
    })

    test("throws before init", () => {
      backend = createAlacrittyBackend()
      expect(() => backend.getText()).toThrow("not initialized")
    })
  })

  describe("text rendering", () => {
    test("renders plain text", () => {
      backend = createBackend()
      feedText(backend, "Hello, world!")
      const text = backend.getText()
      expect(text).toContain("Hello, world!")
    })

    test("renders multiple lines", () => {
      backend = createBackend()
      feedText(backend, "Line 1\r\nLine 2\r\nLine 3")
      const text = backend.getText()
      expect(text).toContain("Line 1")
      expect(text).toContain("Line 2")
      expect(text).toContain("Line 3")
    })

    test("handles cursor positioning", () => {
      backend = createBackend(40, 10)
      feedText(backend, "\x1b[3;5HPlaced") // Move to row 3, col 5
      const text = backend.getText()
      expect(text).toContain("Placed")
    })

    test("handles line wrapping", () => {
      backend = createBackend(10, 5)
      feedText(backend, "1234567890abcde") // Should wrap at col 10
      const text = backend.getText()
      expect(text).toContain("1234567890")
      expect(text).toContain("abcde")
    })
  })

  describe("cell attributes", () => {
    test("detects bold", () => {
      backend = createBackend()
      feedText(backend, "\x1b[1mBold\x1b[0m Normal")
      const boldCell = backend.getCell(0, 0)
      expect(boldCell.bold).toBe(true)
      expect(boldCell.char).toBe("B")

      const normalCell = backend.getCell(0, 5)
      expect(normalCell.bold).toBe(false)
    })

    test("detects italic", () => {
      backend = createBackend()
      feedText(backend, "\x1b[3mItalic\x1b[0m")
      expect(backend.getCell(0, 0).italic).toBe(true)
    })

    test("detects faint/dim", () => {
      backend = createBackend()
      feedText(backend, "\x1b[2mFaint\x1b[0m")
      expect(backend.getCell(0, 0).dim).toBe(true)
    })

    test("detects underline", () => {
      backend = createBackend()
      feedText(backend, "\x1b[4mUnderline\x1b[0m")
      expect(backend.getCell(0, 0).underline).toBe("single")
    })

    test.skip("detects double underline", () => {
      // Alacritty only supports single underline in headless mode
      backend = createBackend()
      feedText(backend, "\x1b[21mDouble\x1b[0m") // SGR 21 = double underline
      expect(backend.getCell(0, 0).underline).toBe("double")
    })

    test("detects curly underline", () => {
      backend = createBackend()
      feedText(backend, "\x1b[4:3mCurly\x1b[0m") // SGR 4:3 = curly
      expect(backend.getCell(0, 0).underline).toBe("curly")
    })

    test("detects dotted underline", () => {
      backend = createBackend()
      feedText(backend, "\x1b[4:4mDotted\x1b[0m") // SGR 4:4 = dotted
      expect(backend.getCell(0, 0).underline).toBe("dotted")
    })

    test("detects dashed underline", () => {
      backend = createBackend()
      feedText(backend, "\x1b[4:5mDashed\x1b[0m") // SGR 4:5 = dashed
      expect(backend.getCell(0, 0).underline).toBe("dashed")
    })

    test("detects strikethrough", () => {
      backend = createBackend()
      feedText(backend, "\x1b[9mStrike\x1b[0m")
      expect(backend.getCell(0, 0).strikethrough).toBe(true)
    })

    test("detects inverse", () => {
      backend = createBackend()
      feedText(backend, "\x1b[7mInverse\x1b[0m")
      expect(backend.getCell(0, 0).inverse).toBe(true)
    })

    test("detects truecolor foreground", () => {
      backend = createBackend()
      feedText(backend, "\x1b[38;2;255;0;0mRed\x1b[0m")
      const cell = backend.getCell(0, 0)
      expect(cell.fg).toEqual({ r: 255, g: 0, b: 0 })
    })

    test("named black and red read back as palette colors, not the default (#30703)", () => {
      backend = createBackend()
      feedText(backend, "\x1b[30;41mK\x1b[0m\x1b[31;40mR\x1b[0mX")
      const black = backend.getCell(0, 0)
      expect(black.fg).toEqual({ r: 0, g: 0, b: 0 })
      expect(black.bg).toEqual({ r: 128, g: 0, b: 0 })
      const red = backend.getCell(0, 1)
      expect(red.fg).toEqual({ r: 128, g: 0, b: 0 })
      expect(red.bg).toEqual({ r: 0, g: 0, b: 0 })
      const plain = backend.getCell(0, 2)
      expect(plain.fg).toBeNull()
      expect(plain.bg).toBeNull()
    })

    test("the other named colors keep their palette values", () => {
      backend = createBackend()
      feedText(backend, "\x1b[32mG\x1b[0m\x1b[97mW\x1b[0m")
      expect(backend.getCell(0, 0).fg).toEqual({ r: 0, g: 128, b: 0 })
      expect(backend.getCell(0, 1).fg).toEqual({ r: 255, g: 255, b: 255 })
    })

    test("detects truecolor background", () => {
      backend = createBackend()
      feedText(backend, "\x1b[48;2;0;255;0mGreen BG\x1b[0m")
      const cell = backend.getCell(0, 0)
      expect(cell.bg).toEqual({ r: 0, g: 255, b: 0 })
    })

    test("detects indexed, truecolor, and reset underline color (SGR 58/59, #31379)", () => {
      backend = createBackend()
      feedText(backend, "\x1b[4;58;5;5mI\x1b[4;58;2;255;0;128mR\x1b[59mD\x1b[0m")
      const indexed = backend.getCell(0, 0)
      expect(indexed.underline).toBe("single")
      expect(indexed.underlineColor).toEqual({ r: 128, g: 0, b: 128 })
      const rgb = backend.getCell(0, 1)
      expect(rgb.underline).toBe("single")
      expect(rgb.underlineColor).toEqual({ r: 255, g: 0, b: 128 })
      const reset = backend.getCell(0, 2)
      expect(reset.underline).toBe("single")
      expect(reset.underlineColor).toBeNull()
    })

    test("resolves indexed and named cell colors through term.colors() after OSC 4 and OSC 104 (#31735)", () => {
      backend = createBackend()
      // Set palette index 1 to an RGB distinct from our display default { r: 128, g: 0, b: 0 }
      feedText(backend, "\x1b]4;1;rgb:12/34/56\x07\x1b[31;48;5;1;4;58;5;1mA\x1b[0m")
      expect(backend.getCell(0, 0)).toMatchObject({
        char: "A",
        fg: { r: 0x12, g: 0x34, b: 0x56 },
        bg: { r: 0x12, g: 0x34, b: 0x56 },
        underline: "single",
        underlineColor: { r: 0x12, g: 0x34, b: 0x56 },
      })
      // OSC 104 clears term.colors()[1] back to None, restoring our display default fallback
      feedText(backend, "\x1b]104;1\x07")
      expect(backend.getCell(0, 0)).toMatchObject({
        char: "A",
        fg: { r: 128, g: 0, b: 0 },
        bg: { r: 128, g: 0, b: 0 },
        underlineColor: { r: 128, g: 0, b: 0 },
      })
    })

    test("detects wide characters", () => {
      backend = createBackend()
      feedText(backend, "\u{1F389}") // party popper emoji
      const cell = backend.getCell(0, 0)
      expect(cell.wide).toBe(true)
    })
  })

  describe("getLine / getLines", () => {
    test("returns cells for a row", () => {
      backend = createBackend(20, 5)
      feedText(backend, "ABCDE")
      const line = backend.getLine(0)
      expect(line[0]!.char).toBe("A")
      expect(line[1]!.char).toBe("B")
      expect(line[4]!.char).toBe("E")
    })

    test("returns all rows", () => {
      backend = createBackend(20, 5)
      feedText(backend, "Row0\r\nRow1\r\nRow2")
      const lines = backend.getLines()
      expect(lines).toHaveLength(5) // All screen rows
    })
  })

  describe("getTextRange", () => {
    test("extracts rectangular region", () => {
      backend = createBackend(20, 5)
      feedText(backend, "ABCDEFGH\r\n12345678")
      const range = backend.getTextRange(0, 2, 1, 6)
      expect(range).toContain("CDEF")
      expect(range).toContain("3456")
    })
  })

  describe("cursor", () => {
    test("reports cursor position", () => {
      backend = createBackend()
      feedText(backend, "Hello")
      const cursor = backend.getCursor()
      expect(cursor.x).toBe(5)
      expect(cursor.y).toBe(0)
    })

    test("tracks cursor after newlines", () => {
      backend = createBackend()
      feedText(backend, "Line1\r\nLine2")
      const cursor = backend.getCursor()
      expect(cursor.y).toBe(1)
      expect(cursor.x).toBe(5)
    })

    test("tracks cursor with escape sequences", () => {
      backend = createBackend()
      feedText(backend, "\x1b[5;10H") // Move to row 5, col 10 (1-based)
      const cursor = backend.getCursor()
      expect(cursor.y).toBe(4) // 0-based
      expect(cursor.x).toBe(9) // 0-based
    })

    test("reports cursor visibility", () => {
      backend = createBackend()
      expect(backend.getCursor().visible).toBe(true)
      feedText(backend, "\x1b[?25l") // Hide cursor
      expect(backend.getCursor().visible).toBe(false)
      feedText(backend, "\x1b[?25h") // Show cursor
      expect(backend.getCursor().visible).toBe(true)
    })
  })

  describe("modes", () => {
    test("detects alt screen mode", () => {
      backend = createBackend()
      expect(backend.getMode("altScreen")).toBe(false)
      feedText(backend, "\x1b[?1049h") // Enter alt screen
      expect(backend.getMode("altScreen")).toBe(true)
      feedText(backend, "\x1b[?1049l") // Exit alt screen
      expect(backend.getMode("altScreen")).toBe(false)
    })

    test("detects bracketed paste mode", () => {
      backend = createBackend()
      expect(backend.getMode("bracketedPaste")).toBe(false)
      feedText(backend, "\x1b[?2004h") // Enable bracketed paste
      expect(backend.getMode("bracketedPaste")).toBe(true)
    })

    test("detects auto wrap mode", () => {
      backend = createBackend()
      // Auto wrap is ON by default
      expect(backend.getMode("autoWrap")).toBe(true)
    })

    test("detects application cursor mode", () => {
      backend = createBackend()
      expect(backend.getMode("applicationCursor")).toBe(false)
      feedText(backend, "\x1b[?1h") // Enable DECCKM
      expect(backend.getMode("applicationCursor")).toBe(true)
    })

    test("returns null for modes not tracked by alacritty_terminal TermMode", () => {
      backend = createBackend()
      expect(backend.getMode("reverseVideo")).toBeNull()
      expect(backend.getMode("sgrMouse" as never)).toBeNull()
    })
  })

  describe("responses", () => {
    test("forwards DECRPM and DA1/DSR engine responses through onResponse", () => {
      backend = createBackend()
      const responses: string[] = []
      backend.onResponse = (bytes) => responses.push(new TextDecoder().decode(bytes))

      feedText(backend, "\x1b[?2004h\x1b[?2004$p")
      feedText(backend, "\x1b[?2004l\x1b[?2004$p")
      feedText(backend, "\x1b[c")
      feedText(backend, "\x1b[5n")

      expect(responses).toEqual(["\x1b[?2004;1$y", "\x1b[?2004;2$y", "\x1b[?6c", "\x1b[0n"])
    })
  })

  describe("scrollback", () => {
    // Existing accumulation tests never distinguish an absolute buffer row from distance to the bottom.
    test("reports absolute viewport rows through scrolling", () => {
      backend = createBackend(20, 3)
      expect(backend.getScrollback()).toEqual({
        viewportTop: 0,
        totalRows: 3,
        screenRows: 3,
        viewportOffset: 0,
        totalLines: 3,
        screenLines: 3,
      })
      feedText(backend, "0\r\n1\r\n2\r\n3\r\n4\r\n5\r\n6\r\n7")
      const expectPosition = (top: number): void => {
        expect(backend!.getScrollback()).toEqual({
          viewportTop: top,
          totalRows: 8,
          screenRows: 3,
          viewportOffset: top,
          totalLines: 8,
          screenLines: 3,
        })
      }
      expectPosition(5)
      // Alacritty's native scroll delta is positive toward older rows.
      backend.scrollViewport(2)
      expectPosition(3)
      backend.scrollViewport(100)
      expectPosition(0)
      backend.scrollViewport(-100)
      expectPosition(5)
    })

    test("reports scrollback state", () => {
      backend = createBackend(20, 5)
      const state = backend.getScrollback()
      expect(state.screenLines).toBe(5)
      expect(state.totalLines).toBeGreaterThanOrEqual(5)
    })

    test("accumulates scrollback lines", () => {
      backend = createBackend(20, 3)
      // Write more lines than screen height to generate scrollback
      for (let i = 0; i < 10; i++) {
        feedText(backend, `Line ${i}\r\n`)
      }
      const state = backend.getScrollback()
      expect(state.totalLines).toBeGreaterThan(3)
    })
  })

  describe("resize", () => {
    test("resizes terminal", () => {
      backend = createBackend(40, 10)
      feedText(backend, "Before resize")
      backend.resize(80, 24)
      feedText(backend, "\r\nAfter resize")
      const text = backend.getText()
      expect(text).toContain("Before resize")
      expect(text).toContain("After resize")
    })
  })

  describe("reset", () => {
    test("clears screen content", () => {
      backend = createBackend()
      feedText(backend, "Some content")
      backend.reset()
      const text = backend.getText()
      expect(text).not.toContain("Some content")
    })
  })

  describe("key encoding", () => {
    test("encodes Enter", () => {
      backend = createBackend()
      const encoded = backend.encodeKey({ key: "Enter" })
      expect(encoded).toEqual(new Uint8Array([0x0d]))
    })

    test("encodes Escape", () => {
      backend = createBackend()
      const encoded = backend.encodeKey({ key: "Escape" })
      expect(encoded).toEqual(new Uint8Array([0x1b]))
    })

    test("encodes Ctrl+C", () => {
      backend = createBackend()
      const encoded = backend.encodeKey({ key: "c", ctrl: true })
      expect(encoded).toEqual(new Uint8Array([3])) // ETX
    })

    test("encodes regular characters", () => {
      backend = createBackend()
      const encoded = backend.encodeKey({ key: "a" })
      expect(new TextDecoder().decode(encoded)).toBe("a")
    })

    test("encodes arrow keys", () => {
      backend = createBackend()
      const encoded = backend.encodeKey({ key: "ArrowUp" })
      expect(new TextDecoder().decode(encoded)).toBe("\x1b[A")
    })

    test("encodes Shift+Arrow", () => {
      backend = createBackend()
      const encoded = backend.encodeKey({ key: "ArrowUp", shift: true })
      expect(new TextDecoder().decode(encoded)).toBe("\x1b[1;2A")
    })

    test("encodes Alt+letter", () => {
      backend = createBackend()
      const encoded = backend.encodeKey({ key: "x", alt: true })
      expect(new TextDecoder().decode(encoded)).toBe("\x1bx")
    })
  })

  describe("capabilities", () => {
    test("reports alacritty capabilities", () => {
      backend = createBackend()
      expect(backend.capabilities.name).toBe("alacritty")
      expect(backend.capabilities.truecolor).toBe(true)
      expect(backend.capabilities.kittyKeyboard).toBe(true)
      expect(backend.capabilities.reflow).toBe(true)
      expect(backend.capabilities.kittyGraphics).toBe(false)
      expect(backend.capabilities.sixel).toBe(false)
    })
  })
})
