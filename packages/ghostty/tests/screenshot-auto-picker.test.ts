/**
 * Tests for Terminal.screenshot()'s auto-picker decision tree (step 3 of
 * @km/infra/mcp-tty-ghostty-backend-toggle).
 *
 * Two real-backend pairings:
 *
 *   1. createGhosttyBackend → backend.screenshot() is wired natively. The
 *      auto-picker delegates to it directly.
 *   2. createXtermBackend → no native screenshot(). The auto-picker proxies
 *      through @termless/ghostty.cellsToAnsi + renderAnsiPng.
 *
 * Both paths must produce non-empty PNGs for the same fixture and stay
 * structurally close (dHash distance) — sanity-checking that the proxy
 * path's cells-roundtrip doesn't drift the visual far from the native one.
 */

import { describe, test, expect, beforeAll } from "vitest"
import { createTerminal } from "../../../src/terminal/terminal.ts"
import { dHash, hashDistance } from "../../../src/compare.ts"
import { createXtermBackend } from "../../xtermjs/src/index.ts"
import { initGhostty, createGhosttyBackend } from "../src/backend.ts"
import type { Ghostty } from "ghostty-web"

const FIXTURE_ANSI = "\x1b[1;31mhello\x1b[0m world"

let ghostty: Ghostty
beforeAll(async () => {
  ghostty = await initGhostty()
})

describe("Terminal.screenshot() — auto-picker", () => {
  test("ghostty backend: uses backend.screenshot() native path", async () => {
    const backend = createGhosttyBackend(undefined, ghostty)
    expect(typeof backend.screenshot).toBe("function")

    const term = createTerminal({ backend, cols: 30, rows: 6 })
    term.feed(FIXTURE_ANSI)

    const png = await term.screenshot({ cols: 30, rows: 6, fontSize: 12 })
    expect(png).toBeInstanceOf(Uint8Array)
    expect(png.length).toBeGreaterThan(0)
    // PNG magic.
    expect(png[0]).toBe(0x89)
    expect(png[1]).toBe(0x50)

    await term.close()
  })

  test("xtermjs backend: proxies via @termless/ghostty (cellsToAnsi + renderAnsiPng)", async () => {
    const backend = createXtermBackend({ cols: 30, rows: 6 })
    // xtermjs is a parser-only backend — must NOT carry a native screenshot.
    expect(backend.screenshot).toBeUndefined()

    const term = createTerminal({ backend, cols: 30, rows: 6 })
    term.feed(FIXTURE_ANSI)

    const png = await term.screenshot({ cols: 30, rows: 6, fontSize: 12 })
    expect(png).toBeInstanceOf(Uint8Array)
    expect(png.length).toBeGreaterThan(0)
    expect(png[0]).toBe(0x89)
    expect(png[1]).toBe(0x50)

    await term.close()
  })

  test("native vs proxy dHash distance stays small for the same input", async () => {
    // Same input fed to both backends; both rendered through ghostty's engine
    // (native uses backend.screenshot, proxy uses cellsToAnsi → renderAnsiPng).
    // The cells-roundtrip can introduce minor drift but the structural similarity
    // should stay within a few bits on an 8×8 grayscale dHash.
    const ghosttyBackend = createGhosttyBackend(undefined, ghostty)
    const ghosttyTerm = createTerminal({ backend: ghosttyBackend, cols: 30, rows: 6 })
    ghosttyTerm.feed(FIXTURE_ANSI)

    const xtermBackend = createXtermBackend({ cols: 30, rows: 6 })
    const xtermTerm = createTerminal({ backend: xtermBackend, cols: 30, rows: 6 })
    xtermTerm.feed(FIXTURE_ANSI)

    const nativePng = await ghosttyTerm.screenshot({ cols: 30, rows: 6, fontSize: 12 })
    const proxyPng = await xtermTerm.screenshot({ cols: 30, rows: 6, fontSize: 12 })

    const nativeHash = await dHash(nativePng)
    const proxyHash = await dHash(proxyPng)
    const distance = hashDistance(nativeHash, proxyHash)

    // Tolerance: 8/64. Small fixture + identical renderer should give near-zero;
    // headroom for parser-disagreement on bold sequences and similar SGR edges.
    expect(
      distance,
      `dHash distance between native+proxy paths: ${distance}/64 ` +
        `(native=${nativeHash} proxy=${proxyHash}). Should be tight — both go ` +
        `through @termless/ghostty's renderer for the same input.`,
    ).toBeLessThanOrEqual(8)

    await ghosttyTerm.close()
    await xtermTerm.close()
  }, 30_000)

  test("Terminal.screenshotCanvasPng() always uses @termless/ghostty regardless of backend", async () => {
    // Even on a ghostty backend, the explicit canvas-png path uses the
    // proxy (cellsToAnsi + renderAnsiPng) — it's the "I want the engine,
    // not the backend's native shortcut" surface. Useful when callers want
    // path-uniform output across backends.
    const backend = createGhosttyBackend(undefined, ghostty)
    const term = createTerminal({ backend, cols: 30, rows: 6 })
    term.feed(FIXTURE_ANSI)

    const png = await term.screenshotCanvasPng({ cols: 30, rows: 6, fontSize: 12 })
    expect(png.length).toBeGreaterThan(0)
    expect(png[0]).toBe(0x89)

    await term.close()
  })
})
