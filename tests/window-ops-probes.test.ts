/**
 * Window-op probe responses — CSI 14t (text-area pixel size) and CSI 18t
 * (text-area cell count) must be answered by every active backend.
 *
 * Why this matters: silvery's `resolveMouseOption()` probes these to
 * determine SGR-Pixels (1016) cell metrics. Without responses the probe
 * times out and silvery falls back to cell-mode SGR mouse — masking
 * pixel-mode wheel bugs that only appear in real terminals (xterm.js in
 * VSCode, Ghostty, etc., all of which answer these probes by default).
 *
 * Termless previously stayed silent on both probes, hiding the
 * pixel-mode path entirely from tests. This is the regression guard for
 * the xterm backend gap. (The ghostty-backend regression test lives in
 * `packages/ghostty/tests/window-ops-probes.test.ts` because the WASM
 * runtime needs a `self` polyfill not available in the termless root
 * vitest config.)
 */

import { describe, test, expect } from "vitest"
import { createXtermBackend } from "../packages/xtermjs/src/backend.ts"
import type { TerminalBackend } from "../src/terminal/types.ts"

const CSI_4_TEXT_AREA_PIXELS_RE = /^\x1b\[4;(\d+);(\d+)t$/
const CSI_8_TEXT_AREA_CELLS_RE = /^\x1b\[8;(\d+);(\d+)t$/

async function probeBackend(backend: TerminalBackend, query: string): Promise<string[]> {
  backend.init?.({ cols: 80, rows: 24 })
  const responses: string[] = []
  backend.onResponse = (b: Uint8Array): void => {
    responses.push(new TextDecoder().decode(b))
  }
  backend.feed(new TextEncoder().encode(query))
  // Allow async response flush — xterm.js is synchronous but the contract
  // permits a microtask.
  await new Promise<void>((r) => setTimeout(r, 50))
  return responses
}

describe("window-op probe responses — xterm backend", () => {
  test("answers CSI 14t with text-area pixel size (CSI 4;h;w t)", async () => {
    const responses = await probeBackend(createXtermBackend(), "\x1b[14t")
    const pixelResponse = responses.find((r) => CSI_4_TEXT_AREA_PIXELS_RE.test(r))
    expect(pixelResponse, `no CSI 4;h;w t response in ${JSON.stringify(responses)}`).toBeDefined()
    const m = CSI_4_TEXT_AREA_PIXELS_RE.exec(pixelResponse!)!
    const height = Number(m[1])
    const width = Number(m[2])
    // Sanity bounds — 80 cols × 24 rows × non-trivial cell size
    expect(height).toBeGreaterThan(24)
    expect(width).toBeGreaterThan(80)
    // Divisible by the configured grid (cellSize integer)
    expect(width % 80).toBe(0)
    expect(height % 24).toBe(0)
  })

  test("answers CSI 18t with text-area cell count (CSI 8;h;w t)", async () => {
    const responses = await probeBackend(createXtermBackend(), "\x1b[18t")
    const cellResponse = responses.find((r) => CSI_8_TEXT_AREA_CELLS_RE.test(r))
    expect(cellResponse, `no CSI 8;h;w t response in ${JSON.stringify(responses)}`).toBeDefined()
    const m = CSI_8_TEXT_AREA_CELLS_RE.exec(cellResponse!)!
    expect(Number(m[1])).toBe(24)
    expect(Number(m[2])).toBe(80)
  })
})
