/**
 * Native canvas render tests — proves @termless/ghostty's renderAnsiPng +
 * renderTerminalPng + cellsToAnsi work end-to-end without Playwright or any
 * browser dependency.
 *
 * The canonical regression gate ("does the new path keep dHash distance to
 * the gold Ghostty reference within tolerance?") is exercised in
 * `apps/km-tui/tests/canonical-render.slow.test.ts` against the legacy path.
 * This file pins the basic API contract plus a dHash check against the same
 * gold reference under the canonical 140×36 geometry.
 */

import { describe, test, expect, beforeAll } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  renderAnsiPng,
  renderTerminalPng,
  _resetDomShimForTesting,
  type CanvasTheme,
} from "../src/render.ts"
import { cellsToAnsi } from "../src/cells-to-ansi.ts"
import { initGhostty, createGhosttyBackend } from "../src/backend.ts"
import type { Ghostty } from "ghostty-web"
import type { TerminalBackend } from "../../../src/types.ts"
import { dHash, hashDistance } from "../../../src/cross-renderer.ts"

// Path to the canonical fixture in km-tui. We don't import via the test file —
// just load the bytes. This dependency is acceptable because the fixture is
// km-owned data, and the ghostty package's tests are run from the km monorepo
// via the workspace's vitest configuration. The fixture lives outside the
// termless repo, so standalone clones (github.com/beorn/termless without km)
// won't have it — the canonical test below is gated on its existence and
// skips cleanly in that case.
const KM_TUI_FIXTURE_DIR = join(__dirname, "..", "..", "..", "..", "..", "apps", "km-tui", "tests", "fixtures", "canonical")
const FIXTURE_ANSI = join(KM_TUI_FIXTURE_DIR, "km-view-140x36.ansi")
const FIXTURE_PNG = join(KM_TUI_FIXTURE_DIR, "km-view-140x36.png")

// Espresso palette — matches the gold reference's theme so dHash isn't
// dominated by palette-only differences.
const ESPRESSO: CanvasTheme = {
  background: "#323232",
  foreground: "#e6e1dc",
  cursor: "#e6e1dc",
  cursorAccent: "#323232",
  black: "#353535",
  red: "#d25252",
  green: "#a5c261",
  yellow: "#ffc66d",
  blue: "#6c99bb",
  magenta: "#d197d9",
  cyan: "#bed6ff",
  white: "#eeeeec",
  brightBlack: "#535353",
  brightRed: "#f00c0c",
  brightGreen: "#c8e573",
  brightYellow: "#ffff80",
  brightBlue: "#7ba9d9",
  brightMagenta: "#ed9eea",
  brightCyan: "#e2faff",
  brightWhite: "#ffffff",
}

const FONT_PATH = "/Users/beorn/Library/Fonts/FiraMonoNerdFontMono-Bold.otf"

// Tolerance: 7/64 is the brief's target (same fidelity as the legacy path).
// We measure against the same gold reference so this gate is apples-to-apples.
const CANVAS_MAX_HAMMING = 7

let ghostty: Ghostty
beforeAll(async () => {
  ghostty = await initGhostty()
})

describe("renderAnsiPng", () => {
  test("produces a valid PNG for a simple ANSI fixture", async () => {
    const png = await renderAnsiPng("\x1b[31mhello\x1b[0m", { cols: 20, rows: 4 })
    expect(png).toBeInstanceOf(Uint8Array)
    expect(png.length).toBeGreaterThan(0)
    // PNG magic: 89 50 4E 47 0D 0A 1A 0A
    expect(png[0]).toBe(0x89)
    expect(png[1]).toBe(0x50) // 'P'
    expect(png[2]).toBe(0x4e) // 'N'
    expect(png[3]).toBe(0x47) // 'G'
  })

  test("returns meta when returnMeta is true", async () => {
    const result = await renderAnsiPng("hi", { cols: 10, rows: 2, returnMeta: true })
    expect(result.png).toBeInstanceOf(Uint8Array)
    expect(result.meta).toBeDefined()
    expect(result.meta.cols).toBe(10)
    expect(result.meta.rows).toBe(2)
    expect(result.meta.cellWidth).toBeGreaterThan(0)
    expect(result.meta.cellHeight).toBeGreaterThan(0)
    expect(result.meta.width).toBeGreaterThan(0)
    expect(result.meta.height).toBeGreaterThan(0)
  })

  test("accepts Uint8Array input", async () => {
    const bytes = new TextEncoder().encode("\x1b[32mok\x1b[0m")
    const png = await renderAnsiPng(bytes, { cols: 10, rows: 2 })
    expect(png.length).toBeGreaterThan(0)
  })

  // Gated on the km-owned fixture: standalone termless clones don't have
  // apps/km-tui/tests/fixtures, so this canonical regression test skips there.
  const hasCanonicalFixture = existsSync(FIXTURE_ANSI) && existsSync(FIXTURE_PNG)
  test.skipIf(!hasCanonicalFixture)("matches the canonical Ghostty reference within tolerance", async () => {
    // Use the same parameter set as the legacy canonical test (cellHeight 14,
    // targetWidth 1680, targetHeight 756, fontSize 10) so the dHash gate
    // measures apples-to-apples.
    const ansi = readFileSync(FIXTURE_ANSI, "utf-8")
    const png = await renderAnsiPng(ansi, {
      cols: 140,
      rows: 36,
      fontSize: 10,
      fontPath: FONT_PATH,
      theme: ESPRESSO,
      cellHeight: 14,
      targetWidth: 1680,
      targetHeight: 756,
    })

    const refBytes = readFileSync(FIXTURE_PNG)
    const refHash = await dHash(new Uint8Array(refBytes.buffer, refBytes.byteOffset, refBytes.byteLength))
    const actHash = await dHash(png)
    const distance = hashDistance(refHash, actHash)

    // Write artifact for visual inspection regardless of pass/fail.
    const { mkdirSync, writeFileSync } = await import("node:fs")
    mkdirSync("/tmp/native-canvas-render", { recursive: true })
    writeFileSync("/tmp/native-canvas-render/actual.png", png)

    expect(
      distance,
      `native canvas render hash distance ${distance}/64 exceeds tolerance ` +
        `${CANVAS_MAX_HAMMING}/64. reference=${refHash} actual=${actHash}. ` +
        `see /tmp/native-canvas-render/actual.png`,
    ).toBeLessThanOrEqual(CANVAS_MAX_HAMMING)
  }, 30_000)
})

describe("renderTerminalPng", () => {
  test("renders a TerminalReadable produced by the ghostty backend", async () => {
    const backend: TerminalBackend = createGhosttyBackend(undefined, ghostty)
    backend.init({ cols: 40, rows: 8 })
    backend.feed(new TextEncoder().encode("\x1b[1mBOLD\x1b[0m normal"))

    const png = await renderTerminalPng(backend, {
      cols: 40,
      rows: 8,
      fontSize: 14,
    })
    expect(png).toBeInstanceOf(Uint8Array)
    expect(png.length).toBeGreaterThan(0)

    backend.destroy()
  })

  test("returnMeta forwards through the wrapper", async () => {
    const backend: TerminalBackend = createGhosttyBackend(undefined, ghostty)
    backend.init({ cols: 20, rows: 4 })
    backend.feed(new TextEncoder().encode("hi"))

    const result = await renderTerminalPng(backend, { cols: 20, rows: 4, returnMeta: true })
    expect(result.meta.cols).toBe(20)
    expect(result.meta.rows).toBe(4)

    backend.destroy()
  })
})

describe("cellsToAnsi", () => {
  test("includes the DECAWM-off preamble", () => {
    const backend: TerminalBackend = createGhosttyBackend(undefined, ghostty)
    backend.init({ cols: 20, rows: 4 })
    backend.feed(new TextEncoder().encode("hi"))

    const ansi = cellsToAnsi(backend, { cols: 20, rows: 4 })
    // Preamble: home + clear + DECAWM-off + cursor-hide.
    expect(ansi.startsWith("\x1b[H\x1b[2J\x1b[?7l\x1b[?25l")).toBe(true)

    backend.destroy()
  })

  test("round-trip: cellsToAnsi(rendered) → renderAnsiPng produces a valid PNG", async () => {
    const backend: TerminalBackend = createGhosttyBackend(undefined, ghostty)
    backend.init({ cols: 30, rows: 6 })
    backend.feed(new TextEncoder().encode("\x1b[36mcyan\x1b[0m"))

    const ansi = cellsToAnsi(backend, { cols: 30, rows: 6 })
    const png = await renderAnsiPng(ansi, { cols: 30, rows: 6 })
    expect(png.length).toBeGreaterThan(0)

    backend.destroy()
  })

  test("emits CRLF between rows, not bare LF", () => {
    const backend: TerminalBackend = createGhosttyBackend(undefined, ghostty)
    backend.init({ cols: 10, rows: 3 })
    backend.feed(new TextEncoder().encode("a\r\nb\r\nc"))

    const ansi = cellsToAnsi(backend, { cols: 10, rows: 3 })
    // Strip the preamble and check row separators. Each non-last row ends
    // with "\x1b[0m\r\n".
    expect(ansi).toContain("\x1b[0m\r\n")

    backend.destroy()
  })
})

describe("DOM shim discipline", () => {
  test("shim does not pollute global state across multiple calls", async () => {
    _resetDomShimForTesting()

    // No DOM globals should exist before the first call (or they're benign).
    // We don't enforce "no DOM before first call" because beforeAll's initGhostty
    // may not touch DOM — but the shim should be idempotent across rapid calls.
    for (let i = 0; i < 3; i++) {
      const png = await renderAnsiPng("\x1b[33myellow\x1b[0m", { cols: 15, rows: 3 })
      expect(png.length).toBeGreaterThan(0)
    }

    // After multiple calls, the shim's document.createElement should still
    // produce a working canvas (no accidental over-replacement).
    const g = globalThis as unknown as { document?: { createElement: (tag: string) => unknown } }
    expect(g.document).toBeDefined()
    expect(typeof g.document!.createElement).toBe("function")

    // window.devicePixelRatio is set to the most recent caller's dpr.
    const w = (globalThis as unknown as { window?: { devicePixelRatio?: number } }).window
    expect(w).toBeDefined()
    expect(typeof w!.devicePixelRatio).toBe("number")
  })
})
