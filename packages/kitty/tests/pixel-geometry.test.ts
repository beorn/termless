/**
 * Declared pixel geometry — kitty backend.
 *
 * @failure CSI 14 t and CSI 16 t answer from the geometry the caller declares in TerminalOptions.pixelGeometry, through
 *   Kitty's own Screen, and follow resize; without a declaration Kitty's 0x0 cell stays (window-ops-probes.test.ts).
 * @level l1
 * @consumer terminfo headless collection: HEADLESS_TERMINAL declares 80x24 cells of 10x20 pixels
 * @testonly none
 */

import { describe, test, expect } from "vitest"
import { createKittyBackend, isKittyAvailable } from "../src/backend.ts"
import type { TerminalOptions } from "../../../src/terminal/types.ts"

const DECLARED: TerminalOptions = { cols: 80, rows: 24, pixelGeometry: { cellWidth: 10, cellHeight: 20 } }

function reply(options: TerminalOptions, query: string, resize?: [cols: number, rows: number]): string {
  const backend = createKittyBackend(options)
  try {
    if (resize) backend.resize(...resize)
    const replies: string[] = []
    backend.onResponse = (bytes: Uint8Array): void => {
      replies.push(new TextDecoder().decode(bytes))
    }
    backend.feed(new TextEncoder().encode(query))
    backend.getCursor() // Kitty replies on the bridge replay, not on feed.
    return replies.join("")
  } finally {
    backend.destroy()
  }
}

describe.skipIf(!isKittyAvailable())("declared pixel geometry — kitty backend", () => {
  test("80x24 cells of 10x20 pixels answer from an 800x480 text area", () => {
    expect(reply(DECLARED, "\x1b[14t\x1b[16t")).toBe("\x1b[4;480;800t\x1b[6;20;10t")
  })

  test("the text area follows resize at the declared cell size", () => {
    expect(reply(DECLARED, "\x1b[14t\x1b[16t", [100, 30])).toBe("\x1b[4;600;1000t\x1b[6;20;10t")
  })

  test("refuses a cell size that is not a positive integer, or a geometry missing one, naming the key", () => {
    for (const [pixelGeometry, key] of [
      [{ cellWidth: 0, cellHeight: 20 }, "cellWidth"],
      [{ cellWidth: 10, cellHeight: -20 }, "cellHeight"],
      [{ cellWidth: 10.5, cellHeight: 20 }, "cellWidth"],
      [{ cellWidth: 10 }, "cellHeight"],
    ] as [TerminalOptions["pixelGeometry"], string][]) {
      expect(() => createKittyBackend({ ...DECLARED, pixelGeometry })).toThrow(
        `pixelGeometry.${key} must be a positive integer`,
      )
    }
  })
})
