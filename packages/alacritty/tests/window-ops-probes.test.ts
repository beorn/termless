/**
 * Window-op probe responses — alacritty backend.
 *
 * alacritty_terminal (Rust via napi-rs) is a cell-grid emulator with no
 * native window pixel concept, so we synthesize CSI 14t (text-area pixel
 * size) and CSI 18t (text-area cell count) responses from configured
 * grid × cell metrics. silvery's `resolveMouseOption()` uses both to
 * enable SGR-Pixels (1016) mouse coordinate mode.
 *
 * Skipped when the native .node binary isn't built locally — the
 * intercept lives in the JS wrapper and is independent of the binary,
 * but the backend can't initialize without it.
 */

import { describe, test, expect } from "vitest"
import { createAlacrittyBackend, loadAlacrittyNative } from "../src/backend.ts"
import type { TerminalBackend } from "../../../src/types.ts"

const CSI_4_TEXT_AREA_PIXELS_RE = /^\x1b\[4;(\d+);(\d+)t$/
const CSI_8_TEXT_AREA_CELLS_RE = /^\x1b\[8;(\d+);(\d+)t$/

// Skip all tests if native module is not available
let nativeAvailable = false
let skipReason = ""
try {
  loadAlacrittyNative()
  nativeAvailable = true
} catch (e) {
  skipReason = e instanceof Error ? e.message.split("\n")[0]! : String(e)
}

const describeNative = nativeAvailable ? describe : describe.skip

async function probeBackend(backend: TerminalBackend, query: string): Promise<string[]> {
  backend.init?.({ cols: 80, rows: 24 })
  const responses: string[] = []
  backend.onResponse = (b: Uint8Array): void => {
    responses.push(new TextDecoder().decode(b))
  }
  backend.feed(new TextEncoder().encode(query))
  await new Promise<void>((r) => setTimeout(r, 50))
  return responses
}

describeNative(`window-op probe responses — alacritty backend${skipReason ? ` (skipped: ${skipReason})` : ""}`, () => {
  test("answers CSI 14t with text-area pixel size (CSI 4;h;w t)", async () => {
    const responses = await probeBackend(createAlacrittyBackend(), "\x1b[14t")
    const pixelResponse = responses.find((r) => CSI_4_TEXT_AREA_PIXELS_RE.test(r))
    expect(pixelResponse, `no CSI 4;h;w t response in ${JSON.stringify(responses)}`).toBeDefined()
    const m = CSI_4_TEXT_AREA_PIXELS_RE.exec(pixelResponse!)!
    const height = Number(m[1])
    const width = Number(m[2])
    expect(height).toBeGreaterThan(24)
    expect(width).toBeGreaterThan(80)
    expect(width % 80).toBe(0)
    expect(height % 24).toBe(0)
  })

  test("answers CSI 18t with text-area cell count (CSI 8;h;w t)", async () => {
    const responses = await probeBackend(createAlacrittyBackend(), "\x1b[18t")
    const cellResponse = responses.find((r) => CSI_8_TEXT_AREA_CELLS_RE.test(r))
    expect(cellResponse, `no CSI 8;h;w t response in ${JSON.stringify(responses)}`).toBeDefined()
    const m = CSI_8_TEXT_AREA_CELLS_RE.exec(cellResponse!)!
    expect(Number(m[1])).toBe(24)
    expect(Number(m[2])).toBe(80)
  })
})
