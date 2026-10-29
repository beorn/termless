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

describe("window-op probe responses — ghostty backend", () => {
  test("leaves pixel CSI 14t/16t silent and formats CSI 18t cell size from Ghostty Termio.zig:540-546 (#31735)", async () => {
    await initGhostty()
    expect(await probeBackend(createGhosttyBackend(), "\x1b[14t")).toEqual([])
    expect(await probeBackend(createGhosttyBackend(), "\x1b[16t")).toEqual([])
    expect(await probeBackend(createGhosttyBackend(), "\x1b[18t")).toEqual(["\x1b[8;24;80t"])
  })
})
