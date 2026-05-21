/**
 * Visual Eyes Phase 7 — cross-backend canvas compare tests.
 *
 * Verifies the "one renderer, N parsers" pipeline: a tape replayed through
 * ghostty + xtermjs, every result rendered through the same canvas, composed
 * into side-by-side / diff panels.
 *
 * The canonical fixture (`fixtures/c1-nel-divergence.tape`) exercises a *real*
 * parser divergence — the C1 NEL control byte (U+0085): xterm.js honours it as
 * "next line"; ghostty-web treats it as inert. The diff overlay must light up.
 */

import { describe, test, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parseTape } from "../../src/recording/tape/parser.ts"
import { compareCanvas } from "../../src/recording/tape/compare-canvas.ts"
import { decodePngRgba } from "../../src/recording/tape/png-codec.ts"
import { createGhosttyBackend, initGhostty } from "../../packages/ghostty/src/index.ts"
import { createXtermBackend } from "../../packages/xtermjs/src/index.ts"

const FIXTURE_DIR = join(import.meta.dirname, "..", "fixtures")

/** Fresh ghostty + xtermjs backend specs. */
async function backends() {
  const gh = await initGhostty()
  return [
    { name: "ghostty", backend: createGhosttyBackend(undefined, gh) },
    { name: "xtermjs", backend: createXtermBackend() },
  ]
}

/** Read a `.tape` fixture and parse it. */
function fixtureTape(name: string) {
  return parseTape(readFileSync(join(FIXTURE_DIR, name), "utf-8"))
}

/** PNG → { width, height } via the package PNG codec. */
function dims(png: Uint8Array) {
  const img = decodePngRgba(png)
  return { width: img.width, height: img.height }
}

describe("compareCanvas — side-by-side", () => {
  test("produces a composed PNG with one panel per backend", async () => {
    const tape = parseTape('Set Width 12\nSet Height 3\nType "hi"\nScreenshot')
    const result = await compareCanvas(tape, { backends: await backends(), mode: "side-by-side" })

    expect(result.backends).toHaveLength(2)
    expect(result.backends[0]!.backend).toBe("ghostty")
    expect(result.backends[1]!.backend).toBe("xtermjs")
    expect(result.composedPng).toBeInstanceOf(Uint8Array)

    // Composed width ≈ sum of two panels + caption band height.
    const panel0 = dims(result.backends[0]!.frames[0]!.png)
    const panel1 = dims(result.backends[1]!.frames[0]!.png)
    const composed = dims(result.composedPng!)
    expect(composed.width).toBe(panel0.width + panel1.width + 12 /* gap */)
    expect(composed.height).toBe(Math.max(panel0.height, panel1.height) + 28 /* caption */)
  }, 30000)

  test("each backend renders the same input through the same canvas", async () => {
    const tape = parseTape('Set Width 12\nSet Height 3\nType "ok"\nScreenshot')
    const result = await compareCanvas(tape, { backends: await backends(), mode: "side-by-side" })
    // Identical input + identical renderer ⇒ identical text.
    expect(result.textMatch).toBe(true)
  }, 30000)
})

describe("compareCanvas — diff", () => {
  test("real parser divergence (C1 NEL) lights up the overlay", async () => {
    const tape = fixtureTape("c1-nel-divergence.tape")
    const result = await compareCanvas(tape, { backends: await backends(), mode: "diff" })

    // xterm.js honours C1 NEL as "next line" → "ab" / "cd" on two rows.
    // ghostty-web keeps the NEL byte inert on row 0 → "abcd" stays one row.
    expect(result.textMatch).toBe(false)
    const ghosttyRow0 = result.backends[0]!.text.split("\n")[0]!
    const xtermRows = result.backends[1]!.text.split("\n").map((r) => r.replace(/ +/g, ""))
    // ghostty: a, b, c, d all on the first row (NEL did not break the line).
    expect(ghosttyRow0.includes("a") && ghosttyRow0.includes("c")).toBe(true)
    // xterm: "ab" on row 0, "cd" on a later row.
    expect(xtermRows[0]).toBe("ab")
    expect(xtermRows.some((r) => r === "cd")).toBe(true)

    // The diff overlay must report a non-zero divergent-pixel count.
    expect(result.divergentPixels).toBeGreaterThan(0)
    expect(result.totalPixels).toBeGreaterThan(0)

    // Composed = N backend panels + 1 divergence panel.
    const composed = dims(result.composedPng!)
    const panelW = result.backends.map((b) => dims(b.frames[0]!.png).width)
    // 3 panels (2 backends + divergence), 2 gaps.
    expect(composed.width).toBe(panelW[0]! * 3 + 12 * 2)
  }, 30000)

  test("identical backends produce a zero-divergence overlay", async () => {
    const tape = parseTape('Set Width 12\nSet Height 3\nType "same"\nScreenshot')
    const gh = await initGhostty()
    const result = await compareCanvas(tape, {
      backends: [
        { name: "ghostty-a", backend: createGhosttyBackend(undefined, gh) },
        { name: "ghostty-b", backend: createGhosttyBackend(undefined, gh) },
      ],
      mode: "diff",
    })
    expect(result.textMatch).toBe(true)
    expect(result.divergentPixels).toBe(0)
  }, 30000)
})

describe("compareCanvas — animation", () => {
  test("animate yields time-synced composed frames", async () => {
    const tape = parseTape('Set Width 12\nSet Height 3\nType "a"\nScreenshot\nType "b"\nScreenshot')
    const result = await compareCanvas(tape, {
      backends: await backends(),
      mode: "side-by-side",
      animate: true,
    })
    // 2 Screenshot commands + 1 synthetic final frame = 3 frames per backend.
    expect(result.composedFrames).toBeDefined()
    expect(result.composedFrames!.length).toBe(3)
    for (const frame of result.composedFrames!) {
      expect(frame).toBeInstanceOf(Uint8Array)
      expect(frame.length).toBeGreaterThan(0)
    }
  }, 30000)
})

describe("compareCanvas — separate", () => {
  test("no composition in separate mode", async () => {
    const tape = parseTape('Type "x"\nScreenshot')
    const result = await compareCanvas(tape, { backends: await backends(), mode: "separate" })
    expect(result.composedPng).toBeUndefined()
    expect(result.backends).toHaveLength(2)
    for (const b of result.backends) {
      expect(b.frames[0]!.png.length).toBeGreaterThan(0)
    }
  }, 30000)
})
