/**
 * Declared pixel geometry — alacritty backend.
 *
 * @failure CSI 14 t answers from the geometry the caller declares in TerminalOptions.pixelGeometry, through
 *   alacritty_terminal's own TextAreaSizeRequest formatter, and follows resize; without a declaration the wrapper
 *   still sends no reply (window-ops-probes.test.ts). A declared text area over 65535 pixels, which the engine's u16
 *   WindowSize cannot hold, is refused at construction and at resize. alacritty_terminal has no CSI 16 t.
 * @level l1
 * @consumer terminfo headless collection: HEADLESS_TERMINAL declares 80x24 cells of 10x20 pixels
 * @testonly none
 */

import { describe, test, expect } from "vitest"
import { createAlacrittyBackend, loadAlacrittyNative } from "../src/backend.ts"
import type { TerminalOptions } from "../../../src/terminal/types.ts"

let skipReason = ""
try {
  loadAlacrittyNative()
} catch (e) {
  skipReason = e instanceof Error ? e.message.split("\n")[0]! : String(e)
}
const describeNative = skipReason ? describe.skip : describe

const DECLARED: TerminalOptions = { cols: 80, rows: 24, pixelGeometry: { cellWidth: 10, cellHeight: 20 } }

function reply(options: TerminalOptions, query: string, resize?: [cols: number, rows: number]): string {
  const backend = createAlacrittyBackend(options)
  try {
    if (resize) backend.resize(...resize)
    const replies: string[] = []
    backend.onResponse = (bytes: Uint8Array): void => {
      replies.push(new TextDecoder().decode(bytes))
    }
    backend.feed(new TextEncoder().encode(query))
    return replies.join("")
  } finally {
    backend.destroy()
  }
}

describeNative(`declared pixel geometry — alacritty backend${skipReason ? ` (skipped: ${skipReason})` : ""}`, () => {
  test("80x24 cells of 10x20 pixels answer from an 800x480 text area", () => {
    expect(reply(DECLARED, "\x1b[14t")).toBe("\x1b[4;480;800t")
  })

  test("the text area follows resize at the declared cell size", () => {
    expect(reply(DECLARED, "\x1b[14t", [100, 30])).toBe("\x1b[4;600;1000t")
  })

  test("refuses a cell size that is not a positive integer, or a geometry missing one, naming the key", () => {
    for (const [pixelGeometry, key] of [
      [{ cellWidth: 0, cellHeight: 20 }, "cellWidth"],
      [{ cellWidth: 10, cellHeight: -20 }, "cellHeight"],
      [{ cellWidth: 10.5, cellHeight: 20 }, "cellWidth"],
      [{ cellWidth: 10 }, "cellHeight"],
    ] as [TerminalOptions["pixelGeometry"], string][]) {
      expect(() => createAlacrittyBackend({ ...DECLARED, pixelGeometry })).toThrow(
        `pixelGeometry.${key} must be a positive integer`,
      )
    }
  })

  test("refuses a declared text area wider than the engine's 65535 pixels, naming the key and the product", () => {
    expect(() => createAlacrittyBackend({ ...DECLARED, cols: 7000 })).toThrow(
      "alacritty backend: pixelGeometry.cellWidth 10 x cols 7000 = 70000 pixels exceeds 65535",
    )
  })

  test("refuses a resize past the engine's 65535 pixels and keeps the declared text area", () => {
    const backend = createAlacrittyBackend(DECLARED)
    try {
      expect(() => backend.resize(80, 3300)).toThrow(
        "alacritty backend: pixelGeometry.cellHeight 20 x rows 3300 = 66000 pixels exceeds 65535",
      )
      const replies: string[] = []
      backend.onResponse = (bytes: Uint8Array): void => {
        replies.push(new TextDecoder().decode(bytes))
      }
      backend.feed(new TextEncoder().encode("\x1b[14t"))
      expect(replies.join("")).toBe("\x1b[4;480;800t")
    } finally {
      backend.destroy()
    }
  })
})
