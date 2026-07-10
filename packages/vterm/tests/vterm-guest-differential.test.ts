/**
 * @failure  vtermGuest silently diverges from the reference xtermGuest on the
 *   core render path (cells, colors, wide chars, alt-screen, region scroll,
 *   scrollback scrolling) — which would make a hab deck ShellPane render
 *   differently depending on which terminal backend the host injected.
 * @level  l1 — two emulators side by side, no React/IO/PTY.
 * @consumer  @si/vterm/21016-terminal-runtime — vtermGuest must be a drop-in
 *   structural mirror of @termless/xtermjs's xtermGuest behind the ShellGuest
 *   seam. The GENUINE divergences captured here (not papered over) are the
 *   conformance-backlog seed the mission asked for.
 *
 * KNOWN / EXPECTED DIVERGENCES (asserted below so a regression that CHANGES the
 * divergence set is caught; each is a conformance-backlog item, not a bug):
 *
 *   D1  ZWJ emoji clustering — vterm renders a ZWJ sequence ("👨‍👩‍👧") as ONE
 *       wide grapheme cell; xterm-unicode11 renders each sub-emoji as its own
 *       wide cell. Real terminals disagree here too; single non-ZWJ emoji agree.
 *   D2  OSC 8 hyperlink presentation — xterm auto-underlines linked cells;
 *       vterm stores the link (cell.url) without forcing underline. The silvery
 *       Cell vocab has no hyperlink slot, so the link itself is dropped by BOTH.
 *   D3  DECSCUSR cursor shape — vterm reports the real shape (underline/bar);
 *       the xterm adapter hardcodes "block". vterm is the faithful one.
 *   D4  DECTCEM cursor visibility — vterm reports real hide/show; the xterm
 *       adapter always reports visible. vterm is the faithful one.
 *   D5  Fancy underline styles (curly/double/dotted/dashed) — vterm reports
 *       `underlineStyle`; the xterm adapter collapses them to plain underline.
 *       vterm is the faithful one; plain single underline agrees.
 */

import { xtermGuest, type XtermGuestHandle } from "@termless/xtermjs"
import { describe, expect, test } from "vitest"
import { vtermGuest, type VtermGuestHandle } from "../src/viewport-adapter.ts"
import type { Cell, CellBuffer, IslandContext, IslandSignal } from "../src/silvery-compat.ts"

function ctx(cols: number, rows: number): IslandContext {
  return {
    cols,
    rows,
    emit: (_signal: IslandSignal) => {},
    requestResize: () => {},
    execOSC: () => Promise.resolve(),
    abortSignal: new AbortController().signal,
    now: () => 0,
  }
}

// xtermGuest re-snapshots on a microtask; vtermGuest reads live. Two ticks
// settle both so the comparison is between two SETTLED buffers.
async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

interface Pair {
  x: XtermGuestHandle
  v: VtermGuestHandle
  dispose(): void
}

async function pair(cols: number, rows: number, scrollback = 0, palettePassthrough = false): Promise<Pair> {
  const x = (await xtermGuest({ cols, rows, scrollback, palettePassthrough }).init(ctx(cols, rows))) as XtermGuestHandle
  const v = (await vtermGuest({ cols, rows, scrollback, palettePassthrough }).init(ctx(cols, rows))) as VtermGuestHandle
  return {
    x,
    v,
    dispose() {
      x.dispose()
      v.dispose()
    },
  }
}

interface CellDiff {
  row: number
  col: number
  xterm: Cell
  vterm: Cell
}

function attrsKey(c: Cell): string {
  return Object.keys(c.attrs)
    .sort()
    .map((k) => `${k}=${(c.attrs as Record<string, unknown>)[k]}`)
    .join(",")
}
function cellKey(c: Cell): string {
  return `${JSON.stringify(c.char)}|${c.fg}|${c.bg}|${c.wide}|${c.continuation}|${attrsKey(c)}`
}

function diffCells(x: CellBuffer, v: CellBuffer): CellDiff[] {
  const rows = Math.max(x.rows, v.rows)
  const cols = Math.max(x.cols, v.cols)
  const diffs: CellDiff[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const xc = x.getCell(col, row)
      const vc = v.getCell(col, row)
      if (cellKey(xc) !== cellKey(vc)) diffs.push({ row, col, xterm: xc, vterm: vc })
    }
  }
  return diffs
}

async function feedBoth(p: Pair, bytes: string): Promise<void> {
  p.x.feedAnsi(bytes)
  p.v.feedAnsi(bytes)
  await flush()
}

// ── Core render path: identical bytes MUST produce identical cells ──────

describe("vtermGuest ⇔ xtermGuest — cell-level parity", () => {
  const CASES: { name: string; cols: number; rows: number; bytes: string; passthrough?: boolean }[] = [
    { name: "plain multi-line text", cols: 20, rows: 3, bytes: "hello\r\nworld" },
    {
      name: "SGR basic attributes (bold/dim/italic/underline/inverse/strike)",
      cols: 20,
      rows: 2,
      bytes: "\x1b[1mB\x1b[0m\x1b[2mD\x1b[0m\x1b[3mI\x1b[0m\x1b[4mU\x1b[0m\x1b[7mR\x1b[0m\x1b[9mS\x1b[0m",
    },
    { name: "16-color fg + bg (normal + bright)", cols: 12, rows: 2, bytes: "\x1b[31;42mX\x1b[0m\x1b[91;104mY\x1b[0m" },
    { name: "256-color fg + bg", cols: 12, rows: 2, bytes: "\x1b[38;5;208m\x1b[48;5;27mZ\x1b[0m" },
    { name: "truecolor fg + bg", cols: 12, rows: 2, bytes: "\x1b[38;2;10;20;30m\x1b[48;2;200;100;50mT\x1b[0m" },
    {
      name: "palette passthrough (ansi256 indices survive; truecolor stays RGB)",
      cols: 12,
      rows: 2,
      bytes: "\x1b[32mG\x1b[38;5;208mI\x1b[38;2;255;128;0mT\x1b[0m",
      passthrough: true,
    },
    { name: "CR overwrite in place", cols: 10, rows: 2, bytes: "abc\rX" },
    { name: "wide CJK (double-width + continuation)", cols: 12, rows: 2, bytes: "你好世界" },
    { name: "single (non-ZWJ) emoji", cols: 12, rows: 2, bytes: "🎉x" },
    { name: "alt-screen enter/exit restores main", cols: 20, rows: 3, bytes: "main\x1b[?1049hALT\x1b[?1049l" },
    { name: "DECSTBM region scroll", cols: 12, rows: 5, bytes: "\x1b[2;4r\x1b[2;1HA\r\nB\r\nC\r\nD\x1b[S" },
    { name: "cursor absolute move (CUP)", cols: 12, rows: 4, bytes: "\x1b[3;5HX" },
  ]

  for (const c of CASES) {
    test(c.name, async () => {
      const p = await pair(c.cols, c.rows, 0, c.passthrough ?? false)
      try {
        await feedBoth(p, c.bytes)
        const diffs = diffCells(p.x.output.buffer, p.v.output.buffer)
        expect(diffs, JSON.stringify(diffs, null, 2)).toEqual([])
      } finally {
        p.dispose()
      }
    })
  }
})

// ── Scrollback: scrolling reveals the SAME older content in both ────────

describe("vtermGuest ⇔ xtermGuest — scrollback scroll parity", () => {
  test("scroll up 3 lines shows identical cells and scrollback geometry", async () => {
    const p = await pair(12, 4, 100)
    try {
      const bytes = Array.from({ length: 10 }, (_, i) => `L${i}`).join("\r\n")
      await feedBoth(p, bytes)
      // Both report the same scrollback geometry at the bottom.
      expect(p.v.getScrollback()).toEqual(p.x.getScrollback())
      p.x.scrollViewport(-3)
      p.v.scrollViewport(-3)
      await flush()
      // Same viewport-top offset after the scroll (sign convention matches).
      expect(p.v.getScrollback()).toEqual(p.x.getScrollback())
      // Same revealed cells.
      expect(diffCells(p.x.output.buffer, p.v.output.buffer)).toEqual([])
    } finally {
      p.dispose()
    }
  })
})

// ── Documented divergences: assert the EXACT known disagreement ─────────

describe("vtermGuest ⇔ xtermGuest — expected divergences (conformance seed)", () => {
  test("D1: ZWJ emoji — vterm clusters to one wide grapheme, xterm splits per sub-emoji", async () => {
    const p = await pair(12, 2)
    try {
      await feedBoth(p, "👨‍👩‍👧x")
      // vterm: single wide grapheme in cell 0, then a continuation slot, then 'x'.
      expect(p.v.output.buffer.getCell(0, 0)).toMatchObject({ char: "👨‍👩‍👧", wide: true })
      expect(p.v.output.buffer.getCell(2, 0).char).toBe("x")
      // xterm: three separate wide sub-emoji occupying 6 columns, 'x' at col 6.
      expect(p.x.output.buffer.getCell(2, 0)).toMatchObject({ char: "👩‍", wide: true })
      expect(p.x.output.buffer.getCell(6, 0).char).toBe("x")
      // The disagreement is real and non-empty.
      expect(diffCells(p.x.output.buffer, p.v.output.buffer).length).toBeGreaterThan(0)
    } finally {
      p.dispose()
    }
  })

  test("D2: OSC 8 hyperlink — xterm auto-underlines linked cells; vterm does not; link dropped by both", async () => {
    const p = await pair(20, 2)
    try {
      await feedBoth(p, "\x1b]8;;http://x.com\x1b\\link\x1b]8;;\x1b\\")
      // Text is identical...
      expect(p.x.output.buffer.getCell(0, 0).char).toBe("l")
      expect(p.v.output.buffer.getCell(0, 0).char).toBe("l")
      // ...but xterm applies underline decoration, vterm does not.
      expect(p.x.output.buffer.getCell(0, 0).attrs.underline).toBe(true)
      expect(p.v.output.buffer.getCell(0, 0).attrs.underline).toBeUndefined()
      // Neither surfaces the URL — the silvery Cell has no hyperlink field.
      expect("url" in p.v.output.buffer.getCell(0, 0)).toBe(false)
    } finally {
      p.dispose()
    }
  })

  test("D3: DECSCUSR — vterm reports the real cursor shape, xterm hardcodes block", async () => {
    const p = await pair(8, 2)
    try {
      await feedBoth(p, "\x1b[4 qA") // steady underline
      expect(p.x.output.cursor?.style).toBe("block")
      expect(p.v.output.cursor?.style).toBe("underline")
      await feedBoth(p, "\x1b[6 qB") // steady bar
      expect(p.v.output.cursor?.style).toBe("bar")
    } finally {
      p.dispose()
    }
  })

  test("D4: DECTCEM — vterm reports real hide/show, xterm always visible", async () => {
    const p = await pair(8, 2)
    try {
      await feedBoth(p, "A\x1b[?25l")
      expect(p.x.output.cursorVisible).toBe(true)
      expect(p.v.output.cursorVisible).toBe(false)
    } finally {
      p.dispose()
    }
  })

  test("D5: fancy underline styles — vterm reports underlineStyle, xterm collapses to plain underline", async () => {
    const p = await pair(8, 2)
    try {
      await feedBoth(p, "\x1b[4:3mX\x1b[0m") // curly
      expect(p.x.output.buffer.getCell(0, 0).attrs).toEqual({ underline: true })
      expect(p.v.output.buffer.getCell(0, 0).attrs).toEqual({ underline: true, underlineStyle: "curly" })
      // Plain single underline, by contrast, agrees exactly.
      const q = await pair(8, 2)
      try {
        await feedBoth(q, "\x1b[4mY\x1b[0m")
        expect(diffCells(q.x.output.buffer, q.v.output.buffer)).toEqual([])
      } finally {
        q.dispose()
      }
    } finally {
      p.dispose()
    }
  })
})
