/**
 * Window-op probe responses — ghostty-native backend.
 *
 * The native Ghostty VT backend has terminal state but no native
 * window pixel concept — there is no
 * real window. We synthesize CSI 14t (text-area pixel size) and CSI
 * 18t (text-area cell count) responses from configured grid × cell
 * metrics. silvery's `resolveMouseOption()` uses both to enable
 * SGR-Pixels (1016) mouse coordinate mode.
 *
 * See `tests/window-ops-probes.test.ts` at the termless root for the
 * full rationale.
 *
 * Note: tests are skipped automatically if the native module hasn't
 * been built (see packages/ghostty-native/build/build.sh).
 */

import { describe, test, expect } from "vitest"
import { createGhosttyNativeBackend, loadGhosttyNative } from "../src/backend.ts"
import type { TerminalBackend } from "../../../src/types.ts"

const CSI_4_TEXT_AREA_PIXELS_RE = /^\x1b\[4;(\d+);(\d+)t$/
const CSI_8_TEXT_AREA_CELLS_RE = /^\x1b\[8;(\d+);(\d+)t$/

let nativeBuildError: string | null = null
try {
  loadGhosttyNative()
} catch (e) {
  nativeBuildError = e instanceof Error ? e.message : String(e)
}

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

describe.skipIf(nativeBuildError !== null)("window-op probe responses — ghostty-native backend", () => {
  test("answers CSI 14t with text-area pixel size (CSI 4;h;w t)", async () => {
    const responses = await probeBackend(createGhosttyNativeBackend(), "\x1b[14t")
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
    const responses = await probeBackend(createGhosttyNativeBackend(), "\x1b[18t")
    const cellResponse = responses.find((r) => CSI_8_TEXT_AREA_CELLS_RE.test(r))
    expect(cellResponse, `no CSI 8;h;w t response in ${JSON.stringify(responses)}`).toBeDefined()
    const m = CSI_8_TEXT_AREA_CELLS_RE.exec(cellResponse!)!
    expect(Number(m[1])).toBe(24)
    expect(Number(m[2])).toBe(80)
  })
})

describe.skipIf(nativeBuildError === null)("window-op probe responses — ghostty-native backend (skipped)", () => {
  test.skip(`ghostty-native module not built — ${nativeBuildError ?? "n/a"}`, () => {})
})
