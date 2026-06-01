/**
 * Palette passthrough for live-multiplexer guests (@km/silvery/19426).
 *
 * Root cause of "colors look paler inside silvermux than the same shell
 * outside": `convertCell` resolves an INDEXED guest color (basic-16 / 256) to a
 * hardcoded STANDARD-palette RGB hex (`PALETTE_256[index]`), discarding the
 * index. The host then emits truecolor `38;2;r;g;b`, so the OUTER terminal
 * paints the standard color instead of its OWN theme palette — e.g. on Ghostty
 * `\x1b[32m` becomes dull `#008000` instead of Ghostty's vivid theme green.
 *
 * For a terminal MULTIPLEXER the correct behavior is to PASS THE INDEX THROUGH
 * (`ansi256(N)`), so the host re-emits `38;5;N` and the outer terminal renders
 * it with its own palette — matching the same shell run outside the mux.
 * Truecolor passes through unchanged. The behavior is OPT-IN (`palettePassthrough`)
 * so recording / rec-overlay guests keep their frozen-RGB isolation by default.
 */

import { describe, test, expect } from "vitest"
import { xtermGuest, type XtermGuestHandle } from "../src/viewport-adapter.ts"
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

async function feed(handle: XtermGuestHandle, ansi: string): Promise<void> {
  handle.feedAnsi(ansi)
  // feedAnsi parses synchronously (writeSync) but re-snapshots on a microtask.
  await Promise.resolve()
  await Promise.resolve()
}

async function mount(palettePassthrough: boolean): Promise<XtermGuestHandle> {
  const guest = xtermGuest({ cols: 12, rows: 3, palettePassthrough })
  const handle = (await guest.init(ctx(12, 3))) as XtermGuestHandle
  return handle
}

describe("xtermGuest palette passthrough (19426)", () => {
  test("passthrough: basic-16 + 256 indices survive as ansi256(N), truecolor unchanged", async () => {
    const handle = await mount(true)
    try {
      // 'G' basic green (SGR 32 → palette 2), 'I' 256-index 208, 'T' truecolor.
      await feed(handle, "\x1b[32mG\x1b[38;5;208mI\x1b[38;2;255;128;0mT\x1b[0m")
      const buf = handle.output.buffer
      // Basic ANSI green must remain an INDEX (palette 2), not the baked
      // standard hex "#008000" — so the outer terminal's palette renders it.
      expect(buf.getCell(0, 0).fg).toBe("ansi256(2)")
      // 256-index must remain an index too.
      expect(buf.getCell(1, 0).fg).toBe("ansi256(208)")
      // Truecolor has no index to preserve — passes through as exact RGB.
      expect(buf.getCell(2, 0).fg).toBe("#ff8000")
    } finally {
      handle.dispose()
    }
  })

  test("default (no passthrough): indices still resolve to standard RGB (back-compat)", async () => {
    const handle = await mount(false)
    try {
      await feed(handle, "\x1b[32mG\x1b[0m")
      // Unchanged legacy behavior — recording/overlay guests keep frozen RGB.
      expect(handle.output.buffer.getCell(0, 0).fg).toBe("#008000")
    } finally {
      handle.dispose()
    }
  })
})
