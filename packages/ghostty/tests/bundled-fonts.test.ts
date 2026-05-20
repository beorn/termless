/**
 * Bundled-font tests — pins canvas-renderer geometry determinism.
 *
 * The canvas renderer must NOT lean on the platform `monospace` alias (whose
 * advance metric is wide and unstable per-OS). With the bundled JetBrains Mono
 * face as the default primary, a no-`fontPath` render produces a deterministic,
 * narrow cell width on every platform — and every render path
 * (Terminal.screenshot, renderTerminalPng, the frame tracer's default renderFn)
 * shares it.
 *
 * Emoji / symbol fallback coverage is pinned by sibling tests added when those
 * fallback faces land.
 */

import { describe, test, expect, beforeAll } from "vitest"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { loadImage } from "@napi-rs/canvas"
import { renderAnsiPng, renderTerminalPng } from "../src/render.ts"
import { initGhostty, createGhosttyBackend } from "../src/backend.ts"
import { createTerminal, createFrameTracer } from "../../../src/index.ts"
import type { Ghostty } from "ghostty-web"
import type { TerminalBackend } from "../../../src/types.ts"

const FONTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "fonts")

let ghostty: Ghostty
beforeAll(async () => {
  ghostty = await initGhostty()
})

describe("bundled fonts are present", () => {
  test("JetBrainsMono-Regular.ttf exists in assets/fonts", () => {
    expect(existsSync(join(FONTS_DIR, "JetBrainsMono-Regular.ttf"))).toBe(true)
  })
})

describe("geometry determinism (bug: frame-trace canvas cell pitch)", () => {
  // The platform `monospace` alias measures ~13px advance at fontSize 16 on a
  // stock napi-canvas — aspect ~0.81. A real fixed-pitch font is ~0.6. With
  // the bundled JetBrains Mono default, a no-fontPath render must land in the
  // real-font band, NOT the wide-alias band.
  test("no-fontPath render uses the bundled monospace metric, not the wide alias", async () => {
    const { meta } = await renderAnsiPng("Empty board", {
      cols: 160,
      rows: 44,
      fontSize: 16,
      returnMeta: true,
    })
    const aspect = meta.cellWidth / meta.cellHeight
    // Real monospace aspect sits around 0.55–0.65. The buggy `monospace`
    // alias produced ~0.72+. A generous ceiling of 0.7 cleanly separates them.
    expect(aspect, `cell aspect ${aspect.toFixed(3)} — too wide, falling back to platform monospace`).toBeLessThan(0.7)
  })

  test("the frame-tracer default render path matches Terminal.screenshot geometry", async () => {
    // The frame tracer's default renderFn calls renderTerminalPng(t, canvas).
    // Terminal.screenshot() on the ghostty backend also routes through
    // renderTerminalPng. Same font => identical cell geometry on both axes.
    const backend: TerminalBackend = createGhosttyBackend(undefined, ghostty)
    backend.init({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("Empty board"))

    // Path A — the ghostty backend's own screenshot (Terminal.screenshot step 1).
    const a = await backend.screenshot!({ cols: 80, rows: 24, returnMeta: true } as never)
    // Path B — the frame tracer's default renderFn: renderTerminalPng(t, canvas).
    const b = await renderTerminalPng(backend, { cols: 80, rows: 24, returnMeta: true })

    const metaA = (a as unknown as { meta: { cellWidth: number; cellHeight: number; width: number; height: number } })
      .meta
    expect(metaA.cellWidth).toBe(b.meta.cellWidth)
    expect(metaA.cellHeight).toBe(b.meta.cellHeight)
    expect(metaA.width).toBe(b.meta.width)
    expect(metaA.height).toBe(b.meta.height)

    backend.destroy()
  })

  test("a real createFrameTracer PNG matches Terminal.screenshot dimensions", async () => {
    // End-to-end guard for the frame-trace fidelity bug: drive a live tracer
    // (default renderFn = renderTerminalPng) and a Terminal.screenshot() of
    // the same state, and assert the PNG dimensions are pixel-identical on
    // both axes. A wrong cell-width or origin offset would diverge here.
    const dir = mkdtempSync(join(tmpdir(), "bundled-fonts-trace-"))
    try {
      let onWrite: ((d: Uint8Array) => void) | undefined
      const term = createTerminal({
        backend: createGhosttyBackend(undefined, ghostty),
        cols: 120,
        rows: 30,
        onAfterWrite: (d) => onWrite?.(d),
      })
      const tracer = createFrameTracer(term, {
        dir,
        debounceMs: 5,
        canvas: { cols: 120, rows: 30 },
        // Frame tracer has no silvery sidecar in this test.
        silveryEventsFile: null,
      })
      onWrite = tracer.onWrite
      term.feed(new TextEncoder().encode("Empty board"))

      const summary = await tracer.stop()
      expect(summary.uniqueCount).toBeGreaterThan(0)

      // The tracer wrote 00001.png — the default renderFn's output.
      const tracePng = await loadImage(join(dir, "00001.png"))
      // Terminal.screenshot() of the same state.
      const shotBytes = await term.screenshot({ cols: 120, rows: 30 })
      const shotImg = await loadImage(Buffer.from(shotBytes))

      expect(tracePng.width).toBe(shotImg.width)
      expect(tracePng.height).toBe(shotImg.height)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
