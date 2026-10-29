/**
 * Ghostty backend tests — real WASM-based terminal emulation.
 *
 * Tests the Ghostty backend implementation using ghostty-web WASM.
 * These mirror the xterm.js backend tests to verify cross-backend compatibility.
 */
import { describe, test, expect, beforeAll, afterEach, vi } from "vitest"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Ghostty, GhosttyTerminal } from "ghostty-web"
import { resolveGhosttyWebWasm } from "../src/load-native.ts"
import { createGhosttyBackend, initGhostty, _resetSharedForTesting } from "../src/backend.ts"
import type { TerminalBackend, HyperlinkExtension } from "../../../src/terminal/types.ts"

let ghostty: Ghostty

beforeAll(async () => {
  ghostty = await initGhostty()
})

function createBackend(cols = 80, rows = 24): TerminalBackend {
  const backend = createGhosttyBackend(undefined, ghostty)
  backend.init({ cols, rows })
  return backend
}

function feedText(backend: TerminalBackend, text: string): void {
  backend.feed(new TextEncoder().encode(text))
}

describe("ghostty backend", () => {
  let backend: TerminalBackend

  afterEach(() => {
    if (backend) backend.destroy()
  })

  // @failure The URI wrapper keeps a detached view, frees borrowed bytes before copying, or conflates status 0/1.
  // @level l0 @consumer GhosttyTerminal URI ABI. Real engine lifecycle tests cannot force memory growth during lookup.
  test("copies URI bytes before another WASM call and releases scratch on every ABI outcome", () => {
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 32 })
    const uri = "https://example.com/é:a"
    let status = 1
    let length = new TextEncoder().encode(uri).length
    let outOfMemory = false
    const release = vi.fn(() => new Uint8Array(memory.buffer, 64, 64).fill(0))
    const allocate = vi.fn(() => {
      if (outOfMemory) return 0
      memory.grow(1)
      return 8
    })
    // Only the FFI is controlled here; the wrapper and WebAssembly.Memory are production/real.
    const exports: Record<string, unknown> = {
      memory,
      ghostty_terminal_new: () => 1,
      ghostty_terminal_free: () => {},
      ghostty_wasm_alloc_u8_array: allocate,
      ghostty_wasm_free_u8_array: release,
      ghostty_render_state_get_hyperlink: (_handle: number, _row: number, _col: number, out: number) => {
        memory.grow(1)
        new Uint8Array(memory.buffer).set(new TextEncoder().encode(uri), 64)
        const words = new DataView(memory.buffer, out, 8)
        words.setUint32(0, 64, true)
        words.setUint32(4, length, true)
        return status
      },
    }
    const terminal = new GhosttyTerminal(
      exports as unknown as ConstructorParameters<typeof GhosttyTerminal>[0],
      memory,
      2,
      1,
    )
    expect(terminal.getHyperlinkAt(0, 1)).toBe(uri)
    expect(release).toHaveBeenLastCalledWith(8, 8)
    length = 0
    expect(terminal.getHyperlinkAt(0, 1)).toBe("")
    status = 0
    expect(terminal.getHyperlinkAt(0, 1)).toBeNull()
    for (const invalid of [-1, 2]) {
      status = invalid
      const frees = release.mock.calls.length
      expect(() => terminal.getHyperlinkAt(0, 1)).toThrow(`status ${invalid}`)
      expect(release.mock.calls.length).toBe(frees + 1)
    }
    const frees = release.mock.calls.length
    outOfMemory = true
    expect(() => terminal.getHyperlinkAt(0, 1)).toThrow(/allocate/)
    expect(release.mock.calls.length).toBe(frees)
    exports.ghostty_render_state_get_hyperlink = undefined
    expect(() => terminal.getHyperlinkAt(0, 1)).toThrow(/missing ghostty_render_state_get_hyperlink/)
    terminal.free()
    expect(() => terminal.getHyperlinkAt(0, 1)).toThrow(/freed/)
  })

  test("committed producer outputs match the pinned build receipt", () => {
    const directory = join(import.meta.dirname, "../../../vendor/ghostty-web")
    const receipt = JSON.parse(readFileSync(join(directory, "RECEIPT.json"), "utf8")) as {
      patchSha256: string
      innerPatchSha256: string
      outputs: Record<string, string>
    }
    for (const [path, expected] of Object.entries({
      ...receipt.outputs,
      "producer.patch": receipt.patchSha256,
      "ghostty-wasm-api.patch": receipt.innerPatchSha256,
    })) {
      expect(
        createHash("sha256")
          .update(readFileSync(join(directory, path)))
          .digest("hex"),
        path,
      ).toBe(expected)
    }
  })

  // @failure OSC 8 URI is lost or read from the wrong buffer row during lifecycle changes.
  // @level l0 @consumer Cell.hyperlink and HyperlinkExtension
  // Existing rendering tests never read URI values; use the real WASM and adapter, with no new test seam.
  test("OSC 8 URI observations survive buffer lifecycle", () => {
    let raw: GhosttyTerminal | undefined
    const create = ghostty.createTerminal.bind(ghostty)
    const spy = vi.spyOn(ghostty, "createTerminal").mockImplementation((...args) => {
      raw = create(...args)
      return raw
    })
    try {
      backend = createBackend(16, 3)
    } finally {
      spy.mockRestore()
    }
    const uri = "https://example.com:8443/a:b?q=c:d"
    const open = `\x1b]8;id=not-the-uri;${uri}\x1b\\`
    const close = "\x1b]8;;\x1b\\"
    feedText(backend, `A${open}LINK${close}Z`)
    // This must fail on the old adapter's actual wrong-null value before any new API is called.
    expect(backend.getCell(0, 1).hyperlink).toBe(uri)
    const links = backend as TerminalBackend & HyperlinkExtension
    expect(backend.capabilities.extensions.has("hyperlinks")).toBe(true)
    const at = (row: number, col: number, char: string, hyperlink: string | null) => {
      expect(backend.getCell(row, col)).toMatchObject({ char, hyperlink })
      expect(backend.getRow(row)[col]).toMatchObject({ char, hyperlink })
      expect(links.getHyperlinkAt(row, col)).toBe(hyperlink)
    }
    for (const [col, char] of [..."ALINKZ"].entries()) {
      at(0, col, char, col > 0 && col < 5 ? uri : null)
    }
    const copied = links.getHyperlinkAt(0, 1)
    feedText(backend, "\x1b[1;2HX")
    at(0, 1, "X", null)
    expect(copied).toBe(uri)

    backend.reset()
    feedText(backend, `${open}OLD${close}\r\none\r\ntwo\r\n${open}LIVE${close}`)
    expect(backend.getScrollback().viewportTop).toBe(1)
    at(0, 0, "O", uri)
    at(1, 0, "o", null)
    at(3, 0, "L", uri)
    // The pinned producer retains the cursor on 1049h; select the tested cell explicitly.
    feedText(backend, `\x1b[?1049h\x1b[H${open}ALT${close}`)
    expect(backend.getScrollback().viewportTop).toBe(0)
    at(0, 0, "A", uri)
    feedText(backend, "\x1b[?1049l")
    expect(backend.getScrollback().viewportTop).toBe(1)
    at(0, 0, "O", uri)
    at(3, 0, "L", uri)
    backend.resize(20, 4)
    at(0, 0, "O", uri)
    at(3, 0, "L", uri)
    backend.reset()
    expect(links.getHyperlinkAt(0, 0)).toBeNull()
    expect(copied).toBe(uri)

    feedText(backend, "\x1b[1;3m界e\u0301\x1b[0m")
    const plain = backend.getRow(0).slice(0, 3)
    expect(plain[0]).toMatchObject({ char: "界", wide: true, bold: true, italic: true })
    expect(plain[2]?.char).toBe("e\u0301")
    backend.reset()
    feedText(backend, `\x1b[1;3m${open}界e\u0301${close}\x1b[0m`)
    if (!raw) throw new Error("Ghostty terminal was not created")
    const producer = raw.getLine(0)
    if (!producer) throw new Error("Ghostty producer returned no live row")
    for (let col = 0; col < 3; col++) {
      const cell = backend.getCell(0, col)
      const native = producer[col]
      if (!native) throw new Error(`Ghostty producer returned no cell at 0:${col}`)
      // The engine decides whether its wide continuation owns a hyperlink; preserve its metadata.
      const hyperlink = native.hyperlink_id ? uri : null
      expect(cell).toEqual({ ...plain[col], hyperlink })
      at(0, col, cell.char, hyperlink)
    }
    expect(links.getHyperlinkAt(-1, 0)).toBeNull()
    expect(links.getHyperlinkAt(0, 20)).toBeNull()
    backend.destroy()
    expect(() => links.getHyperlinkAt(0, 0)).toThrow("not initialized")
  })

  // Q4: real producer replies must reflect the active screen's keyboard stack.
  // Rendering/receipt tests cannot detect an ignored query action.
  test.each(["direct", "adapter"] as const)(
    "Kitty flags queries preserve lifecycle and response order via %s",
    (path) => {
      const create = () => {
        if (path === "direct") {
          const terminal = ghostty.createTerminal(80, 24, { scrollbackLimit: 1000 })
          return {
            write(text: string) {
              terminal.write(text)
              terminal.update()
              let response = ""
              while (terminal.hasResponse()) response += terminal.readResponse() ?? ""
              return response
            },
            dispose: () => terminal.free(),
          }
        }
        const terminal = createBackend()
        let response = ""
        terminal.onResponse = (bytes) => {
          response += new TextDecoder().decode(bytes)
        }
        return {
          write(text: string) {
            response = ""
            feedText(terminal, text)
            return response
          },
          dispose: () => terminal.destroy(),
        }
      }
      const first = create()
      const second = create()
      try {
        expect(first.write("\x1b[5n")).toBe("\x1b[0n")
        expect(first.write("\x1b[?u")).toBe("\x1b[?0u")
        for (const flags of [1, 3, 5, 9, 25, 31]) {
          expect(first.write(`\x1b[>${flags}u\x1b[?u\x1b[<u\x1b[?u`)).toBe(`\x1b[?${flags}u\x1b[?0u`)
        }
        for (const [flags, mode, expected] of [
          [8, 1, 8],
          [3, 2, 11],
          [2, 3, 9],
          [31, 1, 31],
        ]) {
          expect(first.write(`\x1b[=${flags};${mode}u\x1b[?u`)).toBe(`\x1b[?${expected}u`)
        }
        expect(first.write("\x1bc\x1b[?u")).toBe("\x1b[?0u")
        expect(first.write("\x1b[>5u\x1b[?u")).toBe("\x1b[?5u")
        expect(second.write("\x1b[?u")).toBe("\x1b[?0u")
        expect(second.write("\x1b[>9u\x1b[?u")).toBe("\x1b[?9u")
        expect(first.write("\x1b[?u")).toBe("\x1b[?5u")
        expect(first.write("\x1b[?1049h\x1b[?u\x1b[>25u\x1b[?u")).toBe("\x1b[?0u\x1b[?25u")
        expect(first.write("\x1b[?1049l\x1b[?u")).toBe("\x1b[?5u")
        expect(first.write("\x1b[?u\x1b[<u\x1b[?u")).toBe("\x1b[?5u\x1b[?0u")
        expect(first.write("\x1b[5n\x1b[6n")).toBe("\x1b[0n\x1b[1;1R")
      } finally {
        first.dispose()
        second.dispose()
      }
    },
  )

  test.each(["viewport", "scrollback"] as const)("rejects invalid producer ordinals in %s with its digest", (path) => {
    const original = ghostty.createTerminal.bind(ghostty)
    const spy = vi.spyOn(ghostty, "createTerminal").mockImplementation((...args) => {
      const terminal = original(...args)
      const method = path === "viewport" ? "getLine" : "getScrollbackLine"
      const read = terminal[method].bind(terminal)
      terminal[method] = (row) => {
        const cells = read(row)
        if (cells?.[0]) cells[0].underline_style = 6
        return cells
      }
      return terminal
    })
    try {
      backend = createBackend(12, 2)
      feedText(backend, "X")
      if (path === "scrollback") feedText(backend, "\r\nZ\r\nW")
      expect(() => backend.getCell(0, 0)).toThrow(
        `Ghostty producer ${createHash("sha256").update(readFileSync(resolveGhosttyWebWasm())).digest("hex")} returned invalid underline_style 6`,
      )
    } finally {
      spy.mockRestore()
    }
  })

  describe("lifecycle", () => {
    test("creates with correct name", () => {
      backend = createBackend()
      expect(backend.name).toBe("ghostty")
    })

    test("throws before init", () => {
      backend = createGhosttyBackend(undefined, ghostty)
      expect(() => backend.getText()).toThrow("not initialized")
    })

    test("uses sharedGhostty when no explicit instance passed", () => {
      // After initGhostty(), createGhosttyBackend() uses the shared instance
      const b = createGhosttyBackend()
      b.init({ cols: 80, rows: 24 })
      expect(b.getText()).toBeDefined()
      b.destroy()
    })

    test("init throws clear error when WASM not loaded and no instance provided", async () => {
      // Temporarily clear the shared instance to test the guard
      _resetSharedForTesting()
      try {
        const b = createGhosttyBackend()
        expect(() => b.init({ cols: 80, rows: 24 })).toThrow("Ghostty WASM not loaded")
      } finally {
        // Restore shared instance for subsequent tests
        ghostty = await initGhostty()
      }
    })

    test("re-init destroys previous terminal", () => {
      backend = createGhosttyBackend(undefined, ghostty)
      backend.init({ cols: 80, rows: 24 })
      backend.feed(new TextEncoder().encode("First"))
      expect(backend.getText()).toContain("First")

      // Re-init should work cleanly (no leak from previous terminal)
      backend.init({ cols: 40, rows: 10 })
      expect(backend.getText()).not.toContain("First")
    })

    test("destroy makes backend unusable until next init", () => {
      backend = createGhosttyBackend(undefined, ghostty)
      backend.init({ cols: 80, rows: 24 })
      backend.destroy()
      expect(() => backend.getText()).toThrow("not initialized")

      // Can re-init after destroy
      backend.init({ cols: 80, rows: 24 })
      expect(backend.getText()).toBeDefined()
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

    // CTO Stage B: the real installed producer must preserve each style in both
    // viewport and history; the previous single-only case missed rich-style collapse.
    test.each([
      ["none", "\x1b[24m", false],
      ["single", "\x1b[4m", "single"],
      ["double", "\x1b[21m", "double"],
      ["double colon", "\x1b[4:2m", "double"],
      ["curly", "\x1b[4:3m", "curly"],
      ["dotted", "\x1b[4:4m", "dotted"],
      ["dashed", "\x1b[4:5m", "dashed"],
    ] as const)("preserves %s underline in viewport and scrollback", (_name, sequence, expected) => {
      backend = createBackend(12, 2)
      feedText(backend, `\x1b[1m${sequence}X\x1b[24mY`)
      const check = () => {
        expect(backend.getCell(0, 0)).toMatchObject({ char: "X", underline: expected, bold: true })
        expect(backend.getCell(0, 1)).toMatchObject({ char: "Y", underline: false, bold: true })
      }
      check()
      feedText(backend, "\r\nZ\r\nW")
      expect(backend.getScrollback().totalRows).toBeGreaterThan(2)
      check()
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

    // ghostty-web exposes BLINK (64) and INVISIBLE (32) in CellFlags; dropping them reported a
    // blinking or hidden cell as plain, which also renders the cell wrongly for every consumer.
    test("detects blink", () => {
      backend = createBackend()
      feedText(backend, "\x1b[5mBlink\x1b[0m")
      expect(backend.getCell(0, 0).blink).toBe(true)
    })

    test("detects hidden (invisible)", () => {
      backend = createBackend()
      feedText(backend, "\x1b[8mHidden\x1b[0m")
      expect(backend.getCell(0, 0).hidden).toBe(true)
    })

    test("detects truecolor foreground", () => {
      backend = createBackend()
      feedText(backend, "\x1b[38;2;255;0;0mRed\x1b[0m")
      const cell = backend.getCell(0, 0)
      expect(cell.fg).toEqual({ r: 255, g: 0, b: 0 })
    })

    test("detects truecolor background", () => {
      backend = createBackend()
      feedText(backend, "\x1b[48;2;0;255;0mGreen BG\x1b[0m")
      const cell = backend.getCell(0, 0)
      expect(cell.bg).toEqual({ r: 0, g: 255, b: 0 })
    })

    test("detects wide characters", () => {
      backend = createBackend()
      feedText(backend, "🎉")
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

    test("reports cursor visibility as booleans through show/hide/show", () => {
      backend = createBackend()
      feedText(backend, "\x1b[?25h")
      const shown = backend.getCursor().visible
      feedText(backend, "\x1b[?25l")
      const hidden = backend.getCursor().visible
      feedText(backend, "\x1b[?25h")
      const shownAgain = backend.getCursor().visible

      expect([shown, hidden, shownAgain]).toEqual([true, false, true])
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

    test("detects application keypad mode (DEC mode 66)", () => {
      backend = createBackend()
      expect(backend.getMode("applicationKeypad")).toBe(false)
      feedText(backend, "\x1b[?66h") // Enable DECNKM (DEC private mode 66)
      expect(backend.getMode("applicationKeypad")).toBe(true)
      feedText(backend, "\x1b[?66l") // Disable DECNKM
      expect(backend.getMode("applicationKeypad")).toBe(false)
    })
  })

  describe("scrollback", () => {
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
  })

  describe("capabilities", () => {
    test("reports ghostty capabilities", () => {
      backend = createBackend()
      expect(backend.capabilities.name).toBe("ghostty")
      expect(backend.capabilities.truecolor).toBe(true)
      expect(backend.capabilities.kittyKeyboard).toBe(true)
      expect(backend.capabilities.reflow).toBe(true)
    })
  })
})
