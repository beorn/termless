/**
 * Truecolor screenshot color drift (km-infra 19764).
 *
 * Reported: in mcp__tty screenshots, neutral dark greys render teal while
 * saturated red/gold survive. This pins the truecolor → cell → screenshot path
 * with a minimal fixture: feed 24-bit SGR for a grey, a red, and a gold glyph,
 * then assert BOTH the parsed cell RGB and the rendered SVG hex are faithful.
 *
 * Two layers bisect where any drift lives:
 *   1. Renderer in isolation — a mock readable carrying known truecolor cells
 *      through screenshotSvg (no backend). Proves rgbToHex / cellFgBg.
 *   2. Backend path — real SGR parsed by the backend, then screenshotSvg.
 */

import { describe, test, expect } from "vitest"
import { createTerminal } from "../../src/terminal/terminal.ts"
import { createXtermBackend } from "../../packages/xtermjs/src/backend.ts"
import { screenshotSvg } from "../../src/render/svg.ts"
import type {
  Cell,
  CursorState,
  CursorStyle,
  TerminalMode,
  TerminalReadable,
  ScrollbackState,
  UnderlineStyle,
} from "../../src/terminal/types.ts"

const GREY = { r: 60, g: 60, b: 60 } // neutral dark grey — the drift victim
const RED = { r: 220, g: 50, b: 50 } // saturated — reported to survive
const GOLD = { r: 255, g: 215, b: 0 } // saturated — reported to survive

function defaultCell(char = " "): Cell {
  return {
    char,
    fg: null,
    bg: null,
    bold: false,
    dim: false,
    italic: false,
    underline: false as UnderlineStyle,
    underlineColor: null,
    strikethrough: false,
    inverse: false,
    blink: false,
    hidden: false,
    wide: false,
    continuation: false,
    hyperlink: null,
  }
}

/** A one-row mock readable: chars "GRD" with the given fg colors. */
function mockRow(fgs: Cell["fg"][], chars = "GRD"): TerminalReadable {
  const cells: Cell[] = [...chars].map((ch, i) => ({ ...defaultCell(ch), fg: fgs[i] ?? null }))
  const cursor: CursorState = { x: 0, y: 0, visible: false, style: "block" as CursorStyle }
  return {
    getText: () => chars,
    getTextRange: () => chars,
    getCell: (r, c) => cells[c] ?? defaultCell(),
    getLine: (r) => (r === 0 ? cells : []),
    getLines: () => [cells],
    getCursor: () => cursor,
    getMode: (_m: TerminalMode) => false,
    getTitle: () => "",
    getScrollback: (): ScrollbackState => ({ viewportOffset: 0, totalLines: 1, screenLines: 1 }),
  } as TerminalReadable
}

describe("19764 truecolor screenshot color drift", () => {
  // ── Layer 1: renderer in isolation ──
  test("screenshotSvg renders a truecolor grey cell as grey (not teal)", () => {
    const svg = screenshotSvg(mockRow([GREY, RED, GOLD]))
    expect(svg).toContain("#3c3c3c") // grey survives
    expect(svg).toContain("#dc3232") // red survives
    expect(svg).toContain("#ffd700") // gold survives
  })

  // ── Layer 2: backend SGR parse → screenshot ──
  test("truecolor SGR grey survives the backend → screenshot path", () => {
    const term = createTerminal({ backend: createXtermBackend(), cols: 10, rows: 1 })
    // 24-bit fg: grey, red, gold.
    term.feed(
      "\x1b[38;2;60;60;60mG" + "\x1b[38;2;220;50;50mR" + "\x1b[38;2;255;215;0mD" + "\x1b[0m",
    )
    const row = term.getLines()[0]!
    expect(row[0]!.fg).toEqual(GREY) // grey, NOT teal
    expect(row[1]!.fg).toEqual(RED)
    expect(row[2]!.fg).toEqual(GOLD)

    const svg = screenshotSvg(term)
    expect(svg).toContain("#3c3c3c")
    term.close()
  })
})
