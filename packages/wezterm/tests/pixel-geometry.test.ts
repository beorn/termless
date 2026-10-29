/**
 * Declared pixel geometry — wezterm backend.
 *
 * @failure the four pixel queries (XTSMGRAPHICS sixel geometry, CSI 14 t, CSI 16 t, OSC 1337 ReportCellSize) answer
 *   from the geometry the caller declares in TerminalOptions.pixelGeometry and follow resize; without a declaration
 *   the crate's no-display zero stays (window-ops-probes.test.ts).
 * @level l1
 * @consumer terminfo headless collection: HEADLESS_TERMINAL declares 80x24 cells of 10x20 pixels
 * @testonly none
 */

import { describe, test, expect } from "vitest"
import { createWeztermBackend, loadWeztermNative } from "../src/backend.ts"
import type { TerminalOptions } from "../../../src/terminal/types.ts"

let skipReason = ""
try {
  loadWeztermNative()
} catch (e) {
  skipReason = e instanceof Error ? e.message.split("\n")[0]! : String(e)
}
const describeNative = skipReason ? describe.skip : describe

const DECLARED: TerminalOptions = { cols: 80, rows: 24, pixelGeometry: { cellWidth: 10, cellHeight: 20 } }

function reply(options: TerminalOptions, query: string, resize?: [cols: number, rows: number]): string {
  const backend = createWeztermBackend(options)
  if (resize) backend.resize(...resize)
  const replies: string[] = []
  backend.onResponse = (bytes: Uint8Array): void => {
    replies.push(new TextDecoder().decode(bytes))
  }
  backend.feed(new TextEncoder().encode(query))
  return replies.join("")
}

describeNative(`declared pixel geometry — wezterm backend${skipReason ? ` (skipped: ${skipReason})` : ""}`, () => {
  test("80x24 cells of 10x20 pixels answer from an 800x480 text area", () => {
    expect(reply(DECLARED, "\x1b[?2;1S")).toBe("\x1b[?2;0;800;480S")
    expect(reply(DECLARED, "\x1b[14t")).toBe("\x1b[4;480;800t")
    expect(reply(DECLARED, "\x1b[16t")).toBe("\x1b[6;20;10t")
    expect(reply(DECLARED, "\x1b]1337;ReportCellSize\x1b\\")).toBe("\x1b]1337;ReportCellSize=20.0;10.0\x1b\\")
  })

  test("the text area follows resize at the declared cell size", () => {
    expect(reply(DECLARED, "\x1b[14t", [100, 30])).toBe("\x1b[4;600;1000t")
    expect(reply(DECLARED, "\x1b[?2;1S", [100, 30])).toBe("\x1b[?2;0;1000;600S")
  })

  test("refuses a cell size that is not a positive integer, or a geometry missing one, naming the key", () => {
    for (const [pixelGeometry, key] of [
      [{ cellWidth: 0, cellHeight: 20 }, "cellWidth"],
      [{ cellWidth: 10, cellHeight: -20 }, "cellHeight"],
      [{ cellWidth: 10.5, cellHeight: 20 }, "cellWidth"],
      [{ cellWidth: 10 }, "cellHeight"],
    ] as [TerminalOptions["pixelGeometry"], string][]) {
      expect(() => createWeztermBackend({ ...DECLARED, pixelGeometry })).toThrow(
        `pixelGeometry.${key} must be a positive integer`,
      )
    }
  })
})
