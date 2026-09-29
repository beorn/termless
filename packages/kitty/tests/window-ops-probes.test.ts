/**
 * Window-op probe responses — kitty backend.
 *
 * The kitty backend runs kitty's VT parser through a Python subprocess
 * (via batch replay) — it has no real window. We synthesize CSI 14t
 * (text-area pixel size) and CSI 18t (text-area cell count) responses
 * from configured grid × cell metrics. silvery's
 * `resolveMouseOption()` uses both to enable SGR-Pixels (1016) mouse
 * coordinate mode.
 *
 * See `tests/window-ops-probes.test.ts` at the termless root for the
 * full rationale.
 *
 * Note: tests are skipped automatically if kitty isn't installed (the
 * subprocess bridge requires `kitty +runpy` — see backend docs).
 */

import { describe, test, expect } from "vitest"
import { createKittyBackend, isKittyAvailable } from "../src/backend.ts"
import type { TerminalBackend } from "../../../src/terminal/types.ts"

const CSI_4_TEXT_AREA_PIXELS_RE = /^\x1b\[4;(\d+);(\d+)t$/
const CSI_8_TEXT_AREA_CELLS_RE = /^\x1b\[8;(\d+);(\d+)t$/

const kittyAvailable = isKittyAvailable()

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

describe.skipIf(!kittyAvailable)("window-op probe responses — kitty backend", () => {
  /**
   * @failure Kitty batch replay redelivers previous query replies as if they belonged to a later feed.
   * @level l2
   * @consumer Terminfo headless device and mode queries
   */
  test("delivers only each feed's new reply, including after reset", () => {
    const backend = createKittyBackend()
    backend.init({ cols: 80, rows: 24 })
    const responses: string[] = []
    backend.onResponse = (bytes) => responses.push(new TextDecoder().decode(bytes))
    const feed = (sequence: string): void => backend.feed(new TextEncoder().encode(sequence))

    feed("\x1b[6n")
    backend.getCursor() // Kitty's lazy batch replay delivers the pending reply.
    expect(responses.join("")).toBe("\x1b[1;1R")

    responses.length = 0
    feed("\x1b[6n")
    backend.getCursor()
    expect(responses.join("")).toBe("\x1b[1;1R")

    responses.length = 0
    backend.reset()
    backend.getCursor()
    expect(responses).toEqual([])

    feed("\x1b[6n")
    backend.getCursor()
    expect(responses.join("")).toBe("\x1b[1;1R")
    backend.destroy()
  })

  /**
   * @failure A response generated without a listener leaks into the next scoped capture.
   * @level l2
   * @consumer Terminfo headless query capture
   */
  test("consumes replies observed in a snapshot without a listener", () => {
    const backend = createKittyBackend()
    backend.init({ cols: 80, rows: 24 })
    const feed = (sequence: string): void => backend.feed(new TextEncoder().encode(sequence))
    feed("\x1b[6n")
    backend.getCursor()

    const responses: string[] = []
    backend.onResponse = (bytes) => responses.push(new TextDecoder().decode(bytes))
    feed("\x1b[6n")
    backend.getCursor()
    expect(responses.join("")).toBe("\x1b[1;1R")
    backend.destroy()
  })

  test("answers CSI 14t with text-area pixel size (CSI 4;h;w t)", async () => {
    const responses = await probeBackend(createKittyBackend(), "\x1b[14t")
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
    const responses = await probeBackend(createKittyBackend(), "\x1b[18t")
    const cellResponse = responses.find((r) => CSI_8_TEXT_AREA_CELLS_RE.test(r))
    expect(cellResponse, `no CSI 8;h;w t response in ${JSON.stringify(responses)}`).toBeDefined()
    const m = CSI_8_TEXT_AREA_CELLS_RE.exec(cellResponse!)!
    expect(Number(m[1])).toBe(24)
    expect(Number(m[2])).toBe(80)
  })

  /**
   * @failure Headless Kitty drops its title-stack callback and reports XTWINOPS 22/23 unsupported.
   * @level l2
   * @consumer Terminfo headless window-title probes
   */
  test("tracks Kitty's title-only stack with its ten-entry limit", () => {
    const backend = createKittyBackend()
    backend.init?.({ cols: 80, rows: 24 })
    const feed = (sequence: string): void => backend.feed(new TextEncoder().encode(sequence))

    feed("\x1b]2;original\x07\x1b[22;0t\x1b]2;changed\x07")
    expect(backend.getTitle()).toBe("changed")
    feed("\x1b[23;0t")
    expect(backend.getTitle()).toBe("original")

    // Kitty's icon-only form must not save or restore the visible title.
    feed("\x1b[22;1t\x1b]2;icon-only\x07\x1b[23;1t")
    expect(backend.getTitle()).toBe("icon-only")

    // Kitty's window keeps at most ten saved titles; the oldest falls off.
    for (let i = 0; i < 11; i++) feed(`\x1b[22;2t\x1b]2;title-${i}\x07`)
    for (let i = 0; i < 11; i++) feed("\x1b[23;2t")
    expect(backend.getTitle()).toBe("title-0")
  })
})

describe.skipIf(kittyAvailable)("window-op probe responses — kitty backend (skipped)", () => {
  test.skip("kitty binary not found — install via `brew install --cask kitty`", () => {})
})
