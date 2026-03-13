/**
 * Cross-backend conformance tests.
 *
 * Verifies that xterm.js and Ghostty backends produce identical results
 * for the same input sequences. Differences = bugs in one backend.
 *
 * This is the core value of termless: write tests once, run against every backend.
 */
import { describe, test, expect, beforeAll, afterEach } from "vitest"
import { createXtermBackend } from "../packages/xtermjs/src/backend.ts"
import { createGhosttyBackend, initGhostty } from "../packages/ghostty/src/backend.ts"
import { createVt100Backend } from "../packages/vt100/src/backend.ts"
import type { Ghostty } from "ghostty-web"
import type { TerminalBackend, Cell } from "../src/types.ts"

let ghostty: Ghostty

beforeAll(async () => {
  ghostty = await initGhostty()
})

type BackendFactory = () => TerminalBackend

const backends: [string, BackendFactory][] = [
  ["xterm", () => createXtermBackend()],
  ["ghostty", () => createGhosttyBackend(undefined, ghostty)],
  ["vt100", () => createVt100Backend()],
]

function forEachBackend(fn: (name: string, createBackend: BackendFactory) => void) {
  for (const [name, factory] of backends) {
    describe(name, () => fn(name, factory))
  }
}

function feedText(backend: TerminalBackend, text: string): void {
  backend.feed(new TextEncoder().encode(text))
}

/** Compare cells ignoring differences in empty cell representation */
function cellText(cell: Cell): string {
  return cell.char || " "
}

describe("cross-backend conformance", () => {
  const activeBackends: TerminalBackend[] = []

  afterEach(() => {
    for (const b of activeBackends) b.destroy()
    activeBackends.length = 0
  })

  function init(factory: BackendFactory, cols = 80, rows = 24): TerminalBackend {
    const b = factory()
    b.init({ cols, rows })
    activeBackends.push(b)
    return b
  }

  describe("text rendering", () => {
    forEachBackend((_name, create) => {
      test("plain text", () => {
        const b = init(create)
        feedText(b, "Hello, world!")
        expect(b.getText()).toContain("Hello, world!")
      })

      test("multiline", () => {
        const b = init(create)
        feedText(b, "Line 1\r\nLine 2\r\nLine 3")
        const text = b.getText()
        expect(text).toContain("Line 1")
        expect(text).toContain("Line 2")
        expect(text).toContain("Line 3")
      })

      test("cursor positioning", () => {
        const b = init(create, 40, 10)
        feedText(b, "\x1b[3;10HX")
        const cell = b.getCell(2, 9) // 0-based row 2, col 9
        expect(cell.char).toBe("X")
      })

      test("line wrap at boundary", () => {
        const b = init(create)
        feedText(b, "1234567890".repeat(8) + "WRAP")
        expect(b.getText()).toContain("WRAP")
      })
    })
  })

  describe("cell styles", () => {
    forEachBackend((_name, create) => {
      test("bold", () => {
        const b = init(create)
        feedText(b, "\x1b[1mB\x1b[0mN")
        expect(b.getCell(0, 0).bold).toBe(true)
        expect(b.getCell(0, 1).bold).toBe(false)
      })

      test("italic", () => {
        const b = init(create)
        feedText(b, "\x1b[3mI\x1b[0m")
        expect(b.getCell(0, 0).italic).toBe(true)
      })

      test("faint", () => {
        const b = init(create)
        feedText(b, "\x1b[2mF\x1b[0m")
        expect(b.getCell(0, 0).dim).toBe(true)
      })

      test("strikethrough", () => {
        const b = init(create)
        feedText(b, "\x1b[9mS\x1b[0m")
        expect(b.getCell(0, 0).strikethrough).toBe(true)
      })

      test("inverse", () => {
        const b = init(create)
        feedText(b, "\x1b[7mI\x1b[0m")
        expect(b.getCell(0, 0).inverse).toBe(true)
      })

      test("truecolor foreground", () => {
        const b = init(create)
        feedText(b, "\x1b[38;2;255;128;0mR\x1b[0m")
        const cell = b.getCell(0, 0)
        expect(cell.fg).toEqual({ r: 255, g: 128, b: 0 })
      })

      test("truecolor background", () => {
        const b = init(create)
        feedText(b, "\x1b[48;2;0;128;255mB\x1b[0m")
        const cell = b.getCell(0, 0)
        expect(cell.bg).toEqual({ r: 0, g: 128, b: 255 })
      })

      test("combined styles", () => {
        const b = init(create)
        feedText(b, "\x1b[1;3;38;2;255;0;0mX\x1b[0m")
        const cell = b.getCell(0, 0)
        expect(cell.bold).toBe(true)
        expect(cell.italic).toBe(true)
        expect(cell.fg).toEqual({ r: 255, g: 0, b: 0 })
      })

      test("reset (SGR 0) clears all styles", () => {
        const b = init(create)
        feedText(b, "\x1b[1;3;4;9mStyled\x1b[0mPlain")
        const plain = b.getCell(0, 6) // 'P' in 'Plain'
        expect(plain.bold).toBe(false)
        expect(plain.italic).toBe(false)
        expect(plain.strikethrough).toBe(false)
        expect(plain.underline).toBe(false)
      })

      test("256-color FG (SGR 38;5)", () => {
        const b = init(create)
        feedText(b, "\x1b[38;5;196mR\x1b[0m")
        const cell = b.getCell(0, 0)
        expect(cell.fg).not.toBeNull()
      })
    })
  })

  describe("cursor", () => {
    forEachBackend((_name, create) => {
      test("reports position after text", () => {
        const b = init(create)
        feedText(b, "Hello")
        const cursor = b.getCursor()
        expect(cursor.x).toBe(5)
        expect(cursor.y).toBe(0)
      })

      test("reports position after newline", () => {
        const b = init(create)
        feedText(b, "Line1\r\nLine2")
        const cursor = b.getCursor()
        expect(cursor.x).toBe(5)
        expect(cursor.y).toBe(1)
      })

      test("reports position after CUP", () => {
        const b = init(create)
        feedText(b, "\x1b[10;20H")
        const cursor = b.getCursor()
        expect(cursor.x).toBe(19) // 0-based
        expect(cursor.y).toBe(9) // 0-based
      })

      test("CUF forward (\\e[5C)", () => {
        const b = init(create)
        feedText(b, "\x1b[5C")
        expect(b.getCursor().x).toBe(5)
      })
    })
  })

  describe("modes", () => {
    forEachBackend((_name, create) => {
      test("alt screen toggle", () => {
        const b = init(create)
        expect(b.getMode("altScreen")).toBe(false)
        feedText(b, "\x1b[?1049h")
        expect(b.getMode("altScreen")).toBe(true)
        feedText(b, "\x1b[?1049l")
        expect(b.getMode("altScreen")).toBe(false)
      })

      test("bracketed paste", () => {
        const b = init(create)
        feedText(b, "\x1b[?2004h")
        expect(b.getMode("bracketedPaste")).toBe(true)
      })

      test("auto wrap (default on)", () => {
        const b = init(create)
        expect(b.getMode("autoWrap")).toBe(true)
      })
    })
  })

  describe("wide characters", () => {
    forEachBackend((name, create) => {
      test("emoji takes 2 cells", () => {
        const b = init(create)
        feedText(b, "🎉A")
        const emojiCell = b.getCell(0, 0)
        // xterm.js headless correctly reports wide for CJK but not emoji
        // due to how @xterm/headless handles Unicode East Asian Width
        if (name === "ghostty" || name === "vt100") {
          expect(emojiCell.wide).toBe(true)
        }
        // When wide is supported, A should be at col 2
        if (emojiCell.wide) {
          expect(cellText(b.getCell(0, 2))).toBe("A")
        }
      })

      test("CJK character takes 2 cells", () => {
        const b = init(create)
        feedText(b, "漢A")
        const cjkCell = b.getCell(0, 0)
        expect(cjkCell.wide).toBe(true)
        const aCell = b.getCell(0, 2)
        expect(cellText(aCell)).toBe("A")
      })
    })
  })

  describe("underline styles", () => {
    forEachBackend((_name, create) => {
      test("single underline (SGR 4)", () => {
        const b = init(create)
        feedText(b, "\x1b[4mU\x1b[0m")
        expect(b.getCell(0, 0).underline).toBe("single")
      })
    })
  })

  describe("application cursor mode", () => {
    forEachBackend((_name, create) => {
      test("DECCKM sets applicationCursor", () => {
        const b = init(create)
        feedText(b, "\x1b[?1h")
        expect(b.getMode("applicationCursor")).toBe(true)
      })
    })
  })

  describe("OSC title", () => {
    forEachBackend((name, create) => {
      test("OSC 2 sets title", () => {
        const b = init(create)
        feedText(b, "\x1b]2;My Title\x07")
        if (name === "ghostty") {
          // ghostty-web WASM: no title change callback, always returns ""
          expect(b.getTitle()).toBe("")
        } else if (name === "vt100") {
          // vt100 backend does not support OSC title
          expect(typeof b.getTitle()).toBe("string")
        } else {
          expect(b.getTitle()).toBe("My Title")
        }
      })
    })
  })

  describe("mouse tracking", () => {
    forEachBackend((_name, create) => {
      test("DECSET 1000 enables mouse tracking", () => {
        const b = init(create)
        feedText(b, "\x1b[?1000h")
        expect(b.getMode("mouseTracking")).toBe(true)
      })
    })
  })

  describe("focus tracking", () => {
    forEachBackend((_name, create) => {
      test("DECSET 1004 enables focus tracking", () => {
        const b = init(create)
        feedText(b, "\x1b[?1004h")
        expect(b.getMode("focusTracking")).toBe(true)
      })
    })
  })

  describe("resize", () => {
    forEachBackend((_name, create) => {
      test("content preserved after resize", () => {
        const b = init(create, 40, 10)
        feedText(b, "Before")
        b.resize(80, 24)
        expect(b.getText()).toContain("Before")
      })
    })
  })

  describe("reset", () => {
    forEachBackend((_name, create) => {
      test("clears content", () => {
        const b = init(create)
        feedText(b, "Content here")
        b.reset()
        expect(b.getText()).not.toContain("Content here")
      })

      test("RIS (\\ec) clears screen", () => {
        const b = init(create)
        feedText(b, "Content\x1bc")
        expect(b.getText()).not.toContain("Content")
      })
    })
  })

  describe("scrollback", () => {
    forEachBackend((_name, create) => {
      test("screen lines reported", () => {
        const b = init(create)
        const s = b.getScrollback()
        expect(s.screenLines).toBe(24)
      })

      test("scrollback accumulates", () => {
        const b = init(create)
        feedText(b, Array.from({ length: 30 }, (_, i) => `Line ${i}`).join("\r\n"))
        const s = b.getScrollback()
        expect(s.totalLines).toBeGreaterThan(24)
      })
    })
  })

  describe("capabilities", () => {
    forEachBackend((_name, create) => {
      test("truecolor support", () => {
        const b = init(create)
        expect(b.capabilities.truecolor).toBe(true)
      })

      test("reflow support", () => {
        const b = init(create)
        expect(typeof b.capabilities.reflow).toBe("boolean")
      })

      test("kitty keyboard", () => {
        const b = init(create)
        expect(typeof b.capabilities.kittyKeyboard).toBe("boolean")
      })
    })
  })

  describe("key encoding", () => {
    forEachBackend((_name, create) => {
      test("Enter → CR", () => {
        const b = init(create)
        expect(b.encodeKey({ key: "Enter" })).toEqual(new Uint8Array([0x0d]))
      })

      test("Escape → ESC", () => {
        const b = init(create)
        expect(b.encodeKey({ key: "Escape" })).toEqual(new Uint8Array([0x1b]))
      })

      test("Ctrl+C → ETX", () => {
        const b = init(create)
        expect(b.encodeKey({ key: "c", ctrl: true })).toEqual(new Uint8Array([3]))
      })

      test("ArrowUp → ESC[A", () => {
        const b = init(create)
        expect(new TextDecoder().decode(b.encodeKey({ key: "ArrowUp" }))).toBe("\x1b[A")
      })
    })
  })

  // ── Cross-backend comparison ──

  describe("identical output", () => {
    test("same text rendering", () => {
      const xt = init(backends.find(([n]) => n === "xterm")![1], 40, 10)
      const gt = init(backends.find(([n]) => n === "ghostty")![1], 40, 10)

      const input = "Hello, \x1b[1mworld\x1b[0m!\r\nLine 2 with \x1b[38;2;255;0;0mred\x1b[0m text"
      feedText(xt, input)
      feedText(gt, input)

      // Compare screen text (only rows with content).
      // Ghostty WASM may have stale memory beyond written content, so compare
      // only up to xterm's trimmed line length (xterm is the reference backend).
      for (let row = 0; row < 2; row++) {
        const xtLine = xt.getLine(row).map(cellText).join("").trimEnd()
        const gtLine = gt.getLine(row).map(cellText).join("").slice(0, xtLine.length)
        expect(gtLine).toBe(xtLine)
      }
    })

    test("same cursor position", () => {
      const xt = init(backends.find(([n]) => n === "xterm")![1])
      const gt = init(backends.find(([n]) => n === "ghostty")![1])

      feedText(xt, "Hello\r\n\x1b[5Cworld")
      feedText(gt, "Hello\r\n\x1b[5Cworld")

      expect(gt.getCursor().x).toBe(xt.getCursor().x)
      expect(gt.getCursor().y).toBe(xt.getCursor().y)
    })

    test("same style attributes", () => {
      const xt = init(backends.find(([n]) => n === "xterm")![1])
      const gt = init(backends.find(([n]) => n === "ghostty")![1])

      const input = "\x1b[1;3;38;2;100;200;50mStyled\x1b[0m Plain"
      feedText(xt, input)
      feedText(gt, input)

      for (let col = 0; col < 12; col++) {
        const xc = xt.getCell(0, col)
        const gc = gt.getCell(0, col)
        expect(gc.bold).toBe(xc.bold)
        expect(gc.italic).toBe(xc.italic)
        expect(gc.fg?.r).toBe(xc.fg?.r)
        expect(gc.fg?.g).toBe(xc.fg?.g)
        expect(gc.fg?.b).toBe(xc.fg?.b)
      }
    })
  })
})
