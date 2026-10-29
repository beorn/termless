/**
 * Window-op probe responses — wezterm backend.
 *
 * wezterm-term (Rust via napi-rs) answers CSI 14t (text-area pixel size)
 * and CSI 18t (text-area cell count) itself; the wrapper synthesizes
 * neither. Without a declared pixel geometry the text area is the crate's
 * no-display zero, pinned below; declared geometry is covered in
 * pixel-geometry.test.ts.
 *
 * Skipped when the native .node binary isn't built locally.
 */

import { describe, test, expect } from "vitest"
import { createWeztermBackend, loadWeztermNative } from "../src/backend.ts"
import type { TerminalBackend } from "../../../src/terminal/types.ts"

const CSI_4_TEXT_AREA_PIXELS_RE = /^\x1b\[4;(\d+);(\d+)t$/
const CSI_8_TEXT_AREA_CELLS_RE = /^\x1b\[8;(\d+);(\d+)t$/

// Skip all tests if native module is not available
let nativeAvailable = false
let skipReason = ""
try {
  loadWeztermNative()
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

describeNative(`window-op probe responses — wezterm backend${skipReason ? ` (skipped: ${skipReason})` : ""}`, () => {
  test("does not synthesize a positive-pixel CSI 14t response in headless mode", async () => {
    const responses = await probeBackend(createWeztermBackend(), "\x1b[14t")
    const positivePixelResponse = responses.find((r) => /^\x1b\[4;[1-9]\d*;[1-9]\d*t$/.test(r))
    expect(
      positivePixelResponse,
      `unexpected positive-pixel CSI 4;h;w t response in ${JSON.stringify(responses)}`,
    ).toBeUndefined()
  })

  test("answers CSI 18t with text-area cell count (CSI 8;h;w t) from wezterm-term", async () => {
    const responses = await probeBackend(createWeztermBackend(), "\x1b[18t")
    const cellResponse = responses.find((r) => CSI_8_TEXT_AREA_CELLS_RE.test(r))
    expect(cellResponse, `no CSI 8;h;w t response in ${JSON.stringify(responses)}`).toBeDefined()
    const m = CSI_8_TEXT_AREA_CELLS_RE.exec(cellResponse!)!
    expect(Number(m[1])).toBe(24)
    expect(Number(m[2])).toBe(80)
  })
})
