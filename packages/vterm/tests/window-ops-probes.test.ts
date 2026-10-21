/**
 * Window-op probe responses — vterm backend.
 *
 * The adapter forwards vterm.js replies without synthesizing geometry.
 * backend.test.ts checks byte-for-byte engine parity for 14t/16t/18t;
 * these cases retain the actual character-grid and fragmented-query checks.
 *
 * See `tests/window-ops-probes.test.ts` at the termless root for the
 * full rationale on why this regression matters.
 */

import { describe, test, expect } from "vitest"
import { createVtermBackend } from "../src/backend.ts"
import type { TerminalBackend } from "../../../src/terminal/types.ts"

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

describe("window-op probe responses — vterm backend", () => {
  test("answers CSI 18t with text-area cell count (CSI 8;h;w t)", async () => {
    const responses = await probeBackend(createVtermBackend(), "\x1b[18t")
    const cellResponse = responses.find((r) => CSI_8_TEXT_AREA_CELLS_RE.test(r))
    expect(cellResponse, `no CSI 8;h;w t response in ${JSON.stringify(responses)}`).toBeDefined()
    const m = CSI_8_TEXT_AREA_CELLS_RE.exec(cellResponse!)!
    expect(Number(m[1])).toBe(24)
    expect(Number(m[2])).toBe(80)
  })

  test("answers a window probe split across feed chunks", async () => {
    const backend = createVtermBackend()
    backend.init?.({ cols: 80, rows: 24 })
    const responses: string[] = []
    backend.onResponse = (bytes): void => {
      responses.push(new TextDecoder().decode(bytes))
    }

    backend.feed(new TextEncoder().encode("\x1b[1"))
    backend.feed(new TextEncoder().encode("8t"))

    expect(responses.filter((response) => response === "\x1b[8;24;80t")).toHaveLength(1)
  })
})
