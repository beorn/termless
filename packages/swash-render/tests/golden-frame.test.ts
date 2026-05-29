/**
 * Golden-frame test for the swash renderer.
 *
 * The spike's verdict ([[@km/termless/swash-native-renderer-spike]]) was: swash
 * renders **color emoji** where the canvas / resvg renderers fall back to
 * monochrome line-art. This test is the regression guard for that claim — it
 * renders a km-ish frame (text + bold + a color emoji) and asserts the emoji
 * region carries *chromatic* ink, exactly the spike's control:
 * `loadSystemFonts:false` emoji ink 0 → nonzero with the color face.
 */

import { describe, it, expect } from "vitest"
import { existsSync } from "node:fs"
import { createVt100Backend } from "../../vt100/src/index.ts"
import { createXtermBackend } from "../../xtermjs/src/index.ts"
import { createTerminal } from "../../../src/terminal/terminal.ts"
import { renderCells, swashRenderAvailable, swashFontChain } from "../src/index.ts"

const NATIVE = swashRenderAvailable()
const HAS_COLOR_EMOJI = existsSync("/System/Library/Fonts/Apple Color Emoji.ttc")

/** Count pixels whose max-min channel spread exceeds `threshold` — chromatic ink. */
function chromaticPixels(pixels: Uint8Array, threshold = 30): number {
  let n = 0
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!
    const g = pixels[i + 1]!
    const b = pixels[i + 2]!
    if (Math.max(r, g, b) - Math.min(r, g, b) > threshold) n++
  }
  return n
}

/** Count pixels that differ from the default `0x1e1e1e` background — any ink. */
function inkPixels(pixels: Uint8Array): number {
  let n = 0
  for (let i = 0; i < pixels.length; i += 4) {
    if (
      Math.abs(pixels[i]! - 0x1e) > 10 ||
      Math.abs(pixels[i + 1]! - 0x1e) > 10 ||
      Math.abs(pixels[i + 2]! - 0x1e) > 10
    ) {
      n++
    }
  }
  return n
}

describe.skipIf(!NATIVE)("swash renderer — golden frame", () => {
  it("rasterizes a cell grid to a non-empty RGBA bitmap", () => {
    const term = createTerminal({ backend: createVt100Backend(), cols: 20, rows: 3 })
    try {
      term.feed("\x1b[1mBOLD\x1b[0m plain text")
      const bmp = renderCells(term)
      expect(bmp.width).toBeGreaterThan(0)
      expect(bmp.height).toBeGreaterThan(0)
      expect(bmp.pixels.length).toBe(bmp.width * bmp.height * 4)
      // Text glyphs must produce visible ink against the default background.
      expect(inkPixels(new Uint8Array(bmp.pixels))).toBeGreaterThan(50)
    } finally {
      term.close()
    }
  })

  it("font chain includes the bundled faces", () => {
    const chain = swashFontChain()
    // JetBrains Mono + Noto Symbols 2 + Symbols Nerd Font + mono-emoji are
    // always bundled; the color emoji face is appended only when the platform
    // ships one.
    expect(chain.length).toBeGreaterThanOrEqual(4)
  })

  it("renders a Nerd Font marker glyph as real ink, not .notdef tofu", () => {
    // U+F0F6 — the Nerd Font private-use icon TUIs (km) use as a column
    // marker. The bundled Symbols Nerd Font face must cover it; before it was
    // bundled this rendered as a `.notdef` box.
    const term = createTerminal({ backend: createVt100Backend(), cols: 4, rows: 1 })
    try {
      term.feed("\u{F0F6}")
      const bmp = renderCells(term)
      expect(inkPixels(new Uint8Array(bmp.pixels))).toBeGreaterThan(8)
    } finally {
      term.close()
    }
  })

  it("a col-0 left-overhanging glyph is not clipped against the bitmap edge", () => {
    const inkAtLeftEdge = (padding: number): number => {
      const term = createTerminal({ backend: createVt100Backend(), cols: 4, rows: 1 })
      try {
        term.feed("\u{E0B0}")
        const bmp = renderCells(term, { padding })
        const px = new Uint8Array(bmp.pixels)
        let edge = 0
        for (let y = 0; y < bmp.height; y++) {
          const i = y * bmp.width * 4
          if (px[i]! + px[i + 1]! + px[i + 2]! > 0x1e * 3 + 30) edge++
        }
        return edge
      } finally {
        term.close()
      }
    }

    expect(inkAtLeftEdge(0)).toBeGreaterThan(0)
    expect(inkAtLeftEdge(4)).toBe(0)
  })

  it("glyph ink fills the cell with the tuned default metrics", () => {
    const inkBandFill = (opts?: { fontSize?: number; baseline?: number }): number => {
      const term = createTerminal({ backend: createVt100Backend(), cols: 12, rows: 1 })
      try {
        term.feed("\u{C0}\u{C9}Mgjpqy{}")
        const bmp = renderCells(term, opts)
        const px = new Uint8Array(bmp.pixels)
        let minY = bmp.height
        let maxY = 0
        for (let y = 0; y < bmp.height; y++) {
          for (let x = 0; x < bmp.width; x++) {
            const i = (y * bmp.width + x) * 4
            if (px[i]! + px[i + 1]! + px[i + 2]! > 0x1e * 3 + 30) {
              minY = Math.min(minY, y)
              maxY = Math.max(maxY, y)
            }
          }
        }
        return (maxY - minY + 1) / bmp.height
      } finally {
        term.close()
      }
    }

    const tuned = inkBandFill()
    const old = inkBandFill({ fontSize: 16, baseline: 20 * 0.78 })
    expect(tuned).toBeGreaterThan(0.92)
    expect(tuned).toBeGreaterThan(old)
  })

  // The spike's headline finding: swash renders color emoji in color.
  it.skipIf(!HAS_COLOR_EMOJI)("renders a color emoji with chromatic ink", () => {
    // The xterm backend tracks wide emoji as one cell; the pure-TS vt100
    // backend splits astral codepoints into UTF-16 surrogate halves, so the
    // emoji-fidelity guard runs against xterm.
    const term = createTerminal({ backend: createXtermBackend(), cols: 8, rows: 1 })
    try {
      // 🔥 fire — unambiguously colorful (orange/red). A wide glyph.
      term.feed("ok \u{1F525}")
      const bmp = renderCells(term)
      const chromatic = chromaticPixels(new Uint8Array(bmp.pixels))
      // The control: with no color font, this is 0. With Apple Color Emoji in
      // the chain, swash composites the sbix color bitmap → nonzero.
      expect(chromatic).toBeGreaterThan(20)
    } finally {
      term.close()
    }
  })
})
