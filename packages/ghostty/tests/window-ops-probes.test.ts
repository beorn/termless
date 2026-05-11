/**
 * Window-op probe responses — ghostty backend.
 *
 * Counterpart to `tests/window-ops-probes.test.ts` (which covers the
 * xterm backend). Lives here because the termless root vitest config
 * excludes the ghostty package — ghostty-web WASM needs the `self`
 * global polyfill applied by the km vendor vitest project.
 *
 * See sibling test for the rationale.
 */

import { describe, test, expect } from "vitest"
import { initGhostty, createGhosttyBackend } from "../src/backend.ts"
import type { TerminalBackend } from "../../../src/types.ts"

const CSI_4_TEXT_AREA_PIXELS_RE = /^\x1b\[4;(\d+);(\d+)t$/
const CSI_8_TEXT_AREA_CELLS_RE = /^\x1b\[8;(\d+);(\d+)t$/

async function probeBackend(
  backend: TerminalBackend,
  query: string,
): Promise<string[]> {
  backend.init?.({ cols: 80, rows: 24 })
  const responses: string[] = []
  backend.onResponse = (b: Uint8Array): void => {
    responses.push(new TextDecoder().decode(b))
  }
  backend.feed(new TextEncoder().encode(query))
  await new Promise<void>((r) => setTimeout(r, 50))
  return responses
}

describe("window-op probe responses — ghostty backend", () => {
  test("answers CSI 14t with text-area pixel size (CSI 4;h;w t)", async () => {
    await initGhostty()
    const responses = await probeBackend(createGhosttyBackend(), "\x1b[14t")
    const pixelResponse = responses.find((r) => CSI_4_TEXT_AREA_PIXELS_RE.test(r))
    expect(pixelResponse, `no CSI 4;h;w t response in ${JSON.stringify(responses)}`).toBeDefined()
    const m = CSI_4_TEXT_AREA_PIXELS_RE.exec(pixelResponse!)!
    expect(Number(m[1])).toBeGreaterThan(24)
    expect(Number(m[2])).toBeGreaterThan(80)
  })

  test("answers CSI 18t with text-area cell count (CSI 8;h;w t)", async () => {
    await initGhostty()
    const responses = await probeBackend(createGhosttyBackend(), "\x1b[18t")
    const cellResponse = responses.find((r) => CSI_8_TEXT_AREA_CELLS_RE.test(r))
    expect(cellResponse, `no CSI 8;h;w t response in ${JSON.stringify(responses)}`).toBeDefined()
    const m = CSI_8_TEXT_AREA_CELLS_RE.exec(cellResponse!)!
    expect(Number(m[1])).toBe(24)
    expect(Number(m[2])).toBe(80)
  })
})
