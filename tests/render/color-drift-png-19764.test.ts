/**
 * Truecolor screenshot color drift — PNG path (km-infra 19764).
 *
 * The SVG renderer + xterm truecolor parse + cellsToAnsi are all proven faithful
 * (see color-drift-19764.test.ts). The remaining suspect is the PNG path that
 * mcp__tty's `screenshot` tool actually uses: Terminal.screenshot()'s auto-picker
 * (backend-native ghostty canvas → @termless/ghostty proxy → resvg fallback).
 *
 * This drives a full-screen truecolor grey BACKGROUND through Terminal.screenshot,
 * decodes the PNG, and samples a center pixel. A faithful render keeps it neutral
 * grey (r≈g≈b); the reported bug turns it teal (g,b ≫ r).
 */

import { describe, test, expect } from "vitest"
import { createTerminal } from "../../src/terminal/terminal.ts"
import { createXtermBackend } from "../../packages/xtermjs/src/backend.ts"
import { decodePngRgba } from "../../src/index.ts"

describe("19764 truecolor screenshot color drift — PNG path", () => {
  test("a truecolor grey background survives Terminal.screenshot() (not teal)", async () => {
    const term = createTerminal({ backend: createXtermBackend(), cols: 4, rows: 1 })
    // Fill the row with a 24-bit neutral dark grey BACKGROUND.
    term.feed("\x1b[48;2;60;60;60m    \x1b[0m")

    let png: Uint8Array
    try {
      png = await term.screenshot({ cols: 4, rows: 1 })
    } catch (err) {
      // If the PNG renderer (ghostty canvas / resvg) is unavailable in this
      // environment, surface it loudly — that's the reproduce blocker, not a pass.
      throw new Error(`Terminal.screenshot() PNG path unavailable: ${(err as Error).message}`)
    }

    const { width, height, data } = decodePngRgba(png)
    // Sample the center pixel — squarely inside the grey-filled region.
    const cx = Math.floor(width / 2)
    const cy = Math.floor(height / 2)
    const i = (cy * width + cx) * 4
    const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!]

    // Neutral grey: channels within a small tolerance of each other. The bug
    // makes g and b far exceed r (teal). Tolerance is generous (font AA blends
    // bg slightly), but a teal drift is ~tens of points of g,b over r.
    const maxChannel = Math.max(r, g, b)
    const minChannel = Math.min(r, g, b)
    expect(maxChannel - minChannel).toBeLessThan(24)
    // And it should be in the dark-grey ballpark, not a bright teal.
    expect(g - r).toBeLessThan(24)
    expect(b - r).toBeLessThan(24)
  })
})
