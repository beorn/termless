/**
 * @failure  vtermGuest mis-renders the embedded shell: wrong cell char/color/
 *   attribute, wrong wide/continuation split, cursor position/shape/visibility
 *   drift, a resize that doesn't reflow, or a scrolled viewport that keeps
 *   showing the live grid instead of scrollback — any of which corrupts a hab
 *   deck ShellPane running on the vterm backend.
 * @level  l0 — pure emulator + adapter, no React/IO/PTY.
 * @consumer  @si/vterm/21016-terminal-runtime — vtermGuest is the production
 *   island guest injected behind ag/packages/hab-deck ShellGuest seam, a
 *   structural mirror of @termless/xtermjs's xtermGuest.
 */

import { describe, expect, test } from "vitest"
import {
  vtermGuest,
  type VtermGuestChild,
  type VtermGuestHandle,
  type VtermGuestOptions,
} from "../src/viewport-adapter.ts"
import type { IslandContext, IslandSignal } from "../src/silvery-compat.ts"

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

async function mount(opts: Partial<VtermGuestOptions> & { cols: number; rows: number }): Promise<VtermGuestHandle> {
  const guest = vtermGuest({ ...opts })
  return (await guest.init(ctx(opts.cols, opts.rows))) as VtermGuestHandle
}

/** Read a viewport row as trimmed text. */
function rowText(handle: VtermGuestHandle, row: number): string {
  const buf = handle.output.buffer
  let line = ""
  for (let col = 0; col < buf.cols; col++) line += buf.getCell(col, row).char
  return line.replace(/\s+$/u, "")
}

function cellBufferFromRows(rows: string[]): VtermGuestHandle["output"]["buffer"] {
  const grid = rows.map((row) =>
    row.split("").map((char) => ({ char, fg: null, bg: null, attrs: {}, wide: false, continuation: false })),
  )
  return {
    cols: grid.reduce((max, row) => Math.max(max, row.length), 0),
    rows: grid.length,
    getCell(col, row) {
      return grid[row]?.[col] ?? { char: " ", fg: null, bg: null, attrs: {}, wide: false, continuation: false }
    },
  }
}

describe("vtermGuest — render path", () => {
  test("plain text lands as cells with the cursor after it", async () => {
    const handle = await mount({ cols: 10, rows: 3 })
    try {
      handle.feedAnsi("abc")
      expect(rowText(handle, 0)).toBe("abc")
      expect(handle.output.buffer.getCell(0, 0).char).toBe("a")
      expect(handle.output.cursor).toEqual({ row: 0, col: 3, style: "block" })
    } finally {
      handle.dispose()
    }
  })

  test("writeCells applies dirty rectangles without repainting untouched cells", async () => {
    const handle = await mount({ cols: 4, rows: 2 })
    try {
      handle.output.writeCells(
        [{ row: 0, col: 0, width: 4, height: 2 }],
        cellBufferFromRows(["abcd", "efgh"]),
      )
      handle.output.writeCells([{ row: 0, col: 2, width: 1, height: 1 }], cellBufferFromRows(["abZd", "efgh"]))
      expect(rowText(handle, 0)).toBe("abZd")
      expect(rowText(handle, 1)).toBe("efgh")
    } finally {
      handle.dispose()
    }
  })

  test("SGR attributes map onto Cell.attrs", async () => {
    const handle = await mount({ cols: 20, rows: 2 })
    try {
      handle.feedAnsi("\x1b[1mB\x1b[0m\x1b[2mD\x1b[0m\x1b[3mI\x1b[0m\x1b[4mU\x1b[0m\x1b[7mR\x1b[0m\x1b[9mS\x1b[0m")
      const buf = handle.output.buffer
      expect(buf.getCell(0, 0).attrs).toEqual({ bold: true })
      expect(buf.getCell(1, 0).attrs).toEqual({ dim: true })
      expect(buf.getCell(2, 0).attrs).toEqual({ italic: true })
      expect(buf.getCell(3, 0).attrs).toEqual({ underline: true })
      expect(buf.getCell(4, 0).attrs).toEqual({ inverse: true })
      expect(buf.getCell(5, 0).attrs).toEqual({ strikethrough: true })
    } finally {
      handle.dispose()
    }
  })

  test("16 / 256 / truecolor resolve to RGB hex by default", async () => {
    const handle = await mount({ cols: 12, rows: 2 })
    try {
      // basic green fg, basic-green bg, 256-index 208, truecolor.
      handle.feedAnsi("\x1b[32mA\x1b[0m\x1b[42mB\x1b[0m\x1b[38;5;208mC\x1b[0m\x1b[38;2;10;20;30mD\x1b[0m")
      const buf = handle.output.buffer
      expect(buf.getCell(0, 0).fg).toBe("#008000")
      expect(buf.getCell(1, 0).bg).toBe("#008000")
      expect(buf.getCell(2, 0).fg).toBe("#ff8700")
      expect(buf.getCell(3, 0).fg).toBe("#0a141e")
    } finally {
      handle.dispose()
    }
  })

  test("palettePassthrough emits the palette-origin index as ansi256(N); truecolor stays RGB", async () => {
    const handle = await mount({ cols: 12, rows: 2, palettePassthrough: true })
    try {
      // Each indexed SGR carries its ORIGIN index on the resolved color (32 → 2,
      // 38;5;208 → 208); the guest reads that provenance straight off the cell —
      // no RGB reverse-map. Truecolor has no origin index, so it stays exact RGB.
      handle.feedAnsi("\x1b[32mG\x1b[38;5;208mI\x1b[38;2;255;128;0mT\x1b[0m")
      const buf = handle.output.buffer
      expect(buf.getCell(0, 0).fg).toBe("ansi256(2)")
      expect(buf.getCell(1, 0).fg).toBe("ansi256(208)")
      expect(buf.getCell(2, 0).fg).toBe("#ff8000")
    } finally {
      handle.dispose()
    }
  })

  test("palettePassthrough survives an OSC 4 palette mutation — index 1 stays ansi256(1), not the mutated RGB", async () => {
    // Mutate palette entry 1 to a distinctive non-standard RGB (#123456), THEN
    // paint SGR 31 (basic red → palette index 1). vterm resolves 31 to the
    // mutated RGB but tags the ORIGIN index (1) on the cell color.
    const passthrough = await mount({ cols: 8, rows: 2, palettePassthrough: true })
    try {
      passthrough.feedAnsi("\x1b]4;1;#123456\x07\x1b[31mR\x1b[0m")
      // Reading provenance, the cell reports ansi256(1) — faithful to what the
      // app asked for, so the outer terminal re-applies its OWN palette entry 1.
      // The deleted RGB reverse-map could not: it saw only #123456, which is no
      // standard palette entry, so it would have leaked the raw RGB (an OSC-4
      // misclassification) — or, had the mutation coincided with another slot,
      // the WRONG index.
      expect(passthrough.output.buffer.getCell(0, 0).fg).toBe("ansi256(1)")
    } finally {
      passthrough.dispose()
    }

    // Same bytes without passthrough prove the mutation actually took effect: the
    // resolved color IS the mutated RGB, not vterm's built-in red (#800000).
    const resolved = await mount({ cols: 8, rows: 2 })
    try {
      resolved.feedAnsi("\x1b]4;1;#123456\x07\x1b[31mR\x1b[0m")
      expect(resolved.output.buffer.getCell(0, 0).fg).toBe("#123456")
    } finally {
      resolved.dispose()
    }
  })

  test("fancy underline styles surface as underlineStyle (vterm fidelity)", async () => {
    const handle = await mount({ cols: 6, rows: 2 })
    try {
      handle.feedAnsi("\x1b[4:3mX\x1b[0m")
      expect(handle.output.buffer.getCell(0, 0).attrs).toEqual({ underline: true, underlineStyle: "curly" })
    } finally {
      handle.dispose()
    }
  })

  test("wide CJK char occupies a wide cell + a continuation slot", async () => {
    const handle = await mount({ cols: 6, rows: 2 })
    try {
      handle.feedAnsi("你") // 你
      const buf = handle.output.buffer
      expect(buf.getCell(0, 0)).toMatchObject({ char: "你", wide: true, continuation: false })
      expect(buf.getCell(1, 0)).toMatchObject({ char: "", wide: false, continuation: true })
    } finally {
      handle.dispose()
    }
  })

  test("CR overwrites in place", async () => {
    const handle = await mount({ cols: 6, rows: 2 })
    try {
      handle.feedAnsi("abc\rX")
      expect(rowText(handle, 0)).toBe("Xbc")
    } finally {
      handle.dispose()
    }
  })

  test("DECSCUSR cursor shape + DECTCEM visibility are reported live", async () => {
    const handle = await mount({ cols: 6, rows: 2 })
    try {
      handle.feedAnsi("\x1b[4 q")
      expect(handle.output.cursor?.style).toBe("underline")
      expect(handle.output.cursorVisible).toBe(true)
      handle.feedAnsi("\x1b[?25l")
      expect(handle.output.cursorVisible).toBe(false)
    } finally {
      handle.dispose()
    }
  })

  test("mouse-tracking DECSET updates the modes surface", async () => {
    const handle = await mount({ cols: 6, rows: 2 })
    try {
      expect(handle.modes?.modes.mouseTracking).toBe("off")
      handle.feedAnsi("\x1b[?1000h")
      expect(handle.modes?.modes.mouseTracking).toBe("click")
      handle.feedAnsi("\x1b[?1003h")
      expect(handle.modes?.modes.mouseTracking).toBe("any")
      handle.feedAnsi("\x1b[?1000l\x1b[?1003l")
      expect(handle.modes?.modes.mouseTracking).toBe("off")
    } finally {
      handle.dispose()
    }
  })
})

describe("vtermGuest — resize", () => {
  test("requestResize reflows the grid and reports the new size", async () => {
    const handle = await mount({ cols: 10, rows: 3 })
    try {
      handle.feedAnsi("hello")
      handle.size.requestResize(40, 10)
      expect(handle.size.cols).toBe(40)
      expect(handle.size.rows).toBe(10)
      expect(handle.output.buffer.cols).toBe(40)
      expect(handle.output.buffer.rows).toBe(10)
      expect(rowText(handle, 0)).toBe("hello")
    } finally {
      handle.dispose()
    }
  })

  test("size subscribers fire on resize", async () => {
    const handle = await mount({ cols: 10, rows: 3 })
    try {
      let seen: { cols: number; rows: number } | null = null
      handle.size.subscribe((s) => (seen = s))
      handle.size.requestResize(20, 5)
      expect(seen).toEqual({ cols: 20, rows: 5 })
    } finally {
      handle.dispose()
    }
  })
})

describe("vtermGuest — scrollback + viewport", () => {
  async function mountWithLines(rows: number, count: number): Promise<VtermGuestHandle> {
    const handle = await mount({ cols: 12, rows, scrollback: 100 })
    const parts: string[] = []
    for (let i = 0; i < count; i++) parts.push(`L${i}`)
    handle.feedAnsi(parts.join("\r\n"))
    return handle
  }

  test("getScrollback reports totals and viewport-top at the bottom", async () => {
    const handle = await mountWithLines(4, 10) // 10 lines into a 4-row screen → 6 scrolled off
    try {
      const sb = handle.getScrollback()
      expect(sb.screenLines).toBe(4)
      expect(sb.totalLines).toBe(10)
      expect(sb.viewportOffset).toBe(6) // absolute top row (== scrollback length at bottom)
      expect(rowText(handle, 0)).toBe("L6")
      expect(rowText(handle, 3)).toBe("L9")
    } finally {
      handle.dispose()
    }
  })

  test("scrollViewport(negative) reveals older scrollback and moves the offset toward the top", async () => {
    const handle = await mountWithLines(4, 10)
    try {
      handle.scrollViewport(-3)
      const sb = handle.getScrollback()
      expect(sb.viewportOffset).toBe(3) // moved 3 toward the top (older)
      expect(rowText(handle, 0)).toBe("L3")
      expect(rowText(handle, 1)).toBe("L4")
      expect(rowText(handle, 3)).toBe("L6")
      // Scrolling back to the bottom restores the live grid.
      handle.scrollViewport(3)
      expect(handle.getScrollback().viewportOffset).toBe(6)
      expect(rowText(handle, 0)).toBe("L6")
    } finally {
      handle.dispose()
    }
  })

  test("output subscribers are notified after a scroll", async () => {
    const handle = await mountWithLines(4, 10)
    try {
      let hits = 0
      handle.output.subscribe(() => hits++)
      handle.scrollViewport(-2)
      expect(hits).toBeGreaterThan(0)
    } finally {
      handle.dispose()
    }
  })
})

describe("vtermGuest — child wiring + lifecycle", () => {
  function fakeChild(): { child: VtermGuestChild; writes: string[] } {
    const writes: string[] = []
    const child: VtermGuestChild = {
      stdin: {
        write: (chunk) => void writes.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)),
      },
    }
    return { child, writes }
  }

  test("input.feed and sendEof write to the child; emulator query responses round-trip", async () => {
    const { child, writes } = fakeChild()
    const handle = await mount({ cols: 10, rows: 3, child })
    try {
      handle.input?.feed?.(new TextEncoder().encode("ls\r"))
      handle.input?.sendEof?.()
      expect(writes).toContain("ls\r")
      expect(writes).toContain("\x04")
      // A DA1 query in the child's OUTPUT stream must be answered back to stdin.
      writes.length = 0
      handle.feedAnsi("\x1b[c")
      expect(writes.some((w) => w.startsWith("\x1b[?"))).toBe(true)
    } finally {
      handle.dispose()
    }
  })

  test("stdout data pipes into the screen", async () => {
    const listeners: ((chunk: Uint8Array | string) => void)[] = []
    const child: VtermGuestChild = {
      stdout: { on: (_e, l) => void listeners.push(l), off: () => {} },
    }
    const handle = await mount({ cols: 10, rows: 2, child })
    try {
      for (const l of listeners) l("piped")
      expect(rowText(handle, 0)).toBe("piped")
    } finally {
      handle.dispose()
    }
  })

  test("dispose is idempotent and freezes further feeds", async () => {
    const handle = await mount({ cols: 6, rows: 2 })
    handle.feedAnsi("x")
    handle.dispose()
    expect(() => handle.dispose()).not.toThrow()
    expect(() => handle.feedAnsi("y")).not.toThrow()
    expect(rowText(handle, 0)).toBe("x") // last snapshot preserved, no new writes
  })

  test("abort signal disposes the guest", async () => {
    const controller = new AbortController()
    const guest = vtermGuest({ cols: 6, rows: 2 })
    const handle = (await guest.init({
      cols: 6,
      rows: 2,
      emit: () => {},
      requestResize: () => {},
      execOSC: () => Promise.resolve(),
      abortSignal: controller.signal,
      now: () => 0,
    })) as VtermGuestHandle
    handle.feedAnsi("z")
    controller.abort()
    // Post-dispose feed is a no-op; the pre-abort content stays.
    handle.feedAnsi("more")
    expect(rowText(handle, 0)).toBe("z")
  })
})
