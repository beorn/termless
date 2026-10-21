/**
 * Window-op probe responses — vt100 backend.
 *
 * vt100 is a pure-TypeScript cell-grid emulator with no native window
 * pixel concept, so we synthesize CSI 14t (text-area pixel size) and
 * CSI 18t (text-area cell count) responses from configured grid × cell
 * metrics. silvery's `resolveMouseOption()` uses both to enable
 * SGR-Pixels (1016) mouse coordinate mode.
 *
 * See `tests/window-ops-probes.test.ts` at the termless root for the
 * full rationale.
 */

import { describe, test, expect } from "vitest"
import { createVt100Backend } from "../src/backend.ts"
import type { TerminalBackend } from "../../../src/terminal/types.ts"

const CSI_4_TEXT_AREA_PIXELS_RE = /^\x1b\[4;(\d+);(\d+)t$/
const CSI_8_TEXT_AREA_CELLS_RE = /^\x1b\[8;(\d+);(\d+)t$/

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

describe("window-op probe responses — vt100 backend", () => {
  test("does not synthesize a constant-factor CSI 14t pixel response", async () => {
    const responses = await probeBackend(createVt100Backend(), "\x1b[14t")
    const pixelResponse = responses.find((r) => CSI_4_TEXT_AREA_PIXELS_RE.test(r))
    expect(pixelResponse, `unexpected synthetic CSI 4;h;w t response in ${JSON.stringify(responses)}`).toBeUndefined()
  })

  test("answers CSI 18t from engine screen dimensions in input order before subsequent DA1", async () => {
    const backend = createVt100Backend()
    const responses = await probeBackend(backend, "\x1b[18t\x1b[c")
    expect(responses.join("")).toBe("\x1b[8;24;80t\x1b[?1;2c")

    backend.resize(132, 30)
    const resizedResponses: string[] = []
    backend.onResponse = (b: Uint8Array): void => {
      resizedResponses.push(new TextDecoder().decode(b))
    }
    backend.feed(new TextEncoder().encode("\x1b[18t\x1b[c"))
    expect(resizedResponses.join("")).toBe("\x1b[8;30;132t\x1b[?1;2c")
  })
})
