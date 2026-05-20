/**
 * Bundled fallback-font tests — pins the two fidelity fixes:
 *
 *   1. Geometry determinism. The canvas renderer must NOT lean on the
 *      platform `monospace` alias (whose advance metric is wide and unstable
 *      per-OS). With the bundled JetBrains Mono face as the default primary,
 *      a no-`fontPath` render produces a deterministic, narrow cell width on
 *      every platform — and every render path (Terminal.screenshot,
 *      renderTerminalPng, the frame tracer's default renderFn) shares it.
 *
 *   2. Emoji / symbol coverage. Code points outside JetBrains Mono's range
 *      (📁 U+1F4C1, the hourglass ⧗ U+29D7) must render as real glyphs via
 *      the bundled Noto Emoji / Noto Sans Symbols 2 fallbacks — not as
 *      `.notdef` tofu boxes.
 *
 * Both fixes share one mechanism: termless bundles its own fonts and registers
 * them process-wide, woven into every render's font-family chain.
 */

import { describe, test, expect, beforeAll } from "vitest"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createCanvas, loadImage, type ImageData } from "@napi-rs/canvas"
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
  test.each(["JetBrainsMono-Regular.ttf", "NotoSansSymbols2-Regular.ttf", "NotoEmoji-Regular.ttf"])(
    "%s exists in assets/fonts",
    (file) => {
      expect(existsSync(join(FONTS_DIR, file))).toBe(true)
    },
  )
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

// ── Tofu detection helper ────────────────────────────────────────────────────
//
// A `.notdef` tofu glyph is a hollow rectangle: ink only on the cell's
// perimeter, an empty interior. A real glyph (📁, ⧗) puts ink in the
// interior too. So: render one glyph alone, crop the first cell, and measure
// the ratio of inked interior pixels. Tofu ≈ 0 interior ink; a real glyph is
// well above zero.

interface InkStats {
  interiorInk: number
  totalInterior: number
}

/** Decode PNG bytes to an ImageData via @napi-rs/canvas (no extra dep). */
async function decodePng(bytes: Uint8Array): Promise<ImageData> {
  const img = await loadImage(Buffer.from(bytes))
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext("2d")
  ctx.drawImage(img as unknown as never, 0, 0)
  return ctx.getImageData(0, 0, img.width, img.height)
}

function interiorInkRatio(
  img: ImageData,
  cellW: number,
  cellH: number,
  bg: { r: number; g: number; b: number },
): InkStats {
  // Inspect the first cell's interior, inset by 25% on every side so the
  // perimeter (where a tofu box draws its outline) is excluded.
  const insetX = Math.floor(cellW * 0.25)
  const insetY = Math.floor(cellH * 0.25)
  let interiorInk = 0
  let totalInterior = 0
  for (let y = insetY; y < cellH - insetY; y++) {
    for (let x = insetX; x < cellW - insetX; x++) {
      const idx = (y * img.width + x) * 4
      const r = img.data[idx]!
      const g = img.data[idx + 1]!
      const b = img.data[idx + 2]!
      totalInterior++
      const dist = Math.abs(r - bg.r) + Math.abs(g - bg.g) + Math.abs(b - bg.b)
      if (dist > 60) interiorInk++
    }
  }
  return { interiorInk, totalInterior }
}

describe("emoji + symbol coverage (bug: canvas renderer tofu)", () => {
  // dpr 1 keeps the math simple: physical px == logical px.
  const BG = { r: 0x1a, g: 0x1b, b: 0x26 }

  test.each([
    ["📁", "folder emoji U+1F4C1"],
    ["📋", "clipboard emoji U+1F4CB"],
    ["📄", "page emoji U+1F4C4"],
    ["⧗", "hourglass symbol U+29D7"],
  ])("renders %s (%s) as a real glyph, not tofu", async (glyph, _label) => {
    const { png: bytes, meta } = await renderAnsiPng(glyph, {
      cols: 4,
      rows: 2,
      fontSize: 32,
      dpr: 1,
      returnMeta: true,
    })
    const img = await decodePng(bytes)
    const { interiorInk, totalInterior } = interiorInkRatio(img, meta.cellWidth, meta.cellHeight, BG)
    const ratio = interiorInk / totalInterior
    // A real glyph fills a meaningful fraction of its cell interior. A `.notdef`
    // tofu box leaves the interior empty (≈ 0). 5% is a comfortable floor that
    // separates "drew a glyph" from "drew a hollow box / nothing".
    expect(ratio, `interior ink ratio ${(ratio * 100).toFixed(1)}% — looks like tofu / blank`).toBeGreaterThan(0.05)
  })
})
