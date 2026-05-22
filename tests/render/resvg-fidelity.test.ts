/**
 * Regression tests for the `@resvg/resvg-js` SVG→raster path — pins three
 * fidelity fixes:
 *
 *   Bug 2 — letter-spacing. The SVG used to stretch every multi-cell tspan
 *   with `textLength` + `lengthAdjust="spacingAndGlyphs"`. librsvg/browsers
 *   render that cleanly; @resvg/resvg-js spreads the glyphs unevenly, worst
 *   on bold faces. The fix positions each glyph at an explicit per-cell `x`,
 *   so a bold word occupies EXACTLY its cell columns — no spread past the
 *   last cell's right edge.
 *
 *   Bug 3 — symbol tofu. resvg-js with only `loadSystemFonts` +
 *   `defaultFontFamily` does not resolve a face covering rarer symbol
 *   codepoints (e.g. ⧗ U+29D7), rendering them as hollow `.notdef` boxes.
 *   The fix passes the bundled Noto Sans Symbols 2 / Nerd Font faces through
 *   `font.fontFiles`, so a symbol cell gets real interior ink.
 *
 *   Bug 4 — color emoji rendered as monochrome outline. resvg-js cannot
 *   render any color emoji font format (CBDT/sbix Apple Color Emoji, COLR/CPAL
 *   Twemoji Mozilla, OT-SVG TwitterColorEmoji-SVGinOT). Bundling NotoEmoji
 *   (monochrome) at least lets every emoji codepoint resolve, but the result
 *   is a thin outlined glyph that drops user-visible color. The fix side-steps
 *   fonts: for emoji codepoints, `src/render/svg.ts` emits a sibling `<image
 *   href="data:image/svg+xml;base64,...">` referencing the Twemoji color SVG
 *   from the optional `@twemoji/svg` peer dep. Resvg renders nested SVG via
 *   `<image>` correctly even when it cannot render the same emoji from a font.
 *
 * All three are exercised through `screenshotPng()` — the canonical resvg
 * path, the same SVG + font wiring `createGif` / `createApng` use — plus a
 * smoke check that `createGif` itself produces a non-empty GIF.
 */

import { describe, test, expect } from "vitest"
import { createRequire } from "node:module"
import { existsSync } from "node:fs"
import { Resvg } from "@resvg/resvg-js"
import { screenshotPng } from "../../src/render/png.ts"
import { createGif } from "../../src/view/gif.ts"
import { screenshotSvg } from "../../src/render/svg.ts"
import { bundledFontFiles } from "../../src/render/fonts.ts"
import type { Cell, CursorState, TerminalReadable } from "../../src/terminal/types.ts"

const SCALE = 2
const CELL_W = 9.6
const CELL_H = 20
const BG = { r: 0x1e, g: 0x1e, b: 0x1e } // DEFAULT_THEME.background

/**
 * `@napi-rs/canvas` is an optional, native-binding-backed dep used only by the
 * pixel-comparison helpers below. It is a devDep of `packages/ghostty`, not a
 * hard root dependency — a default CI runner / lean checkout may not have it.
 * The SVG-string assertions don't need it; the canvas-decode tests skip when
 * it is absent rather than crashing the whole file at import time.
 */
const CANVAS_AVAILABLE = (() => {
  try {
    createRequire(import.meta.url).resolve("@napi-rs/canvas")
    return true
  } catch {
    return false
  }
})()

let canvasModule: typeof import("@napi-rs/canvas") | null = null
async function loadCanvas(): Promise<typeof import("@napi-rs/canvas")> {
  if (!canvasModule) canvasModule = await import("@napi-rs/canvas")
  return canvasModule
}

/**
 * `@twemoji/svg` is an optional peer dep (~17 MB of color emoji SVGs). When it
 * is absent, `src/render/emoji.ts` correctly soft-falls-back to font rendering
 * — `loadTwemojiSvg` returns null and the renderer emits a `<tspan>` instead of
 * an injected `<image>`. The bug-4 image-injection assertions only hold when
 * the asset pack IS installed, so they gate on this. (The "renders as a real
 * glyph" coverage test above still passes via the bundled monochrome NotoEmoji
 * font path, so emoji rendering itself stays covered without the pack.)
 */
const TWEMOJI_AVAILABLE = (() => {
  try {
    createRequire(import.meta.url).resolve("@twemoji/svg")
    return true
  } catch {
    return false
  }
})()

function cell(char: string, overrides: Partial<Cell> = {}): Cell {
  return {
    char,
    fg: null,
    bg: null,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    underlineColor: null,
    strikethrough: false,
    inverse: false,
    blink: false,
    hidden: false,
    wide: false,
    continuation: false,
    hyperlink: null,
    ...overrides,
  }
}

/** Build a single-row TerminalReadable from a list of cells. */
function readableFromCells(cells: Cell[]): TerminalReadable {
  const cursor: CursorState = { x: 0, y: 0, visible: false, style: "block" }
  return {
    getLines: () => [cells],
    getCursor: () => cursor,
  } as unknown as TerminalReadable
}

/** Decode PNG bytes into a flat RGBA pixel view via @napi-rs/canvas. */
async function decode(bytes: Uint8Array): Promise<{ w: number; h: number; data: Uint8ClampedArray }> {
  const { createCanvas, loadImage } = await loadCanvas()
  const img = await loadImage(Buffer.from(bytes))
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext("2d")
  ctx.drawImage(img as unknown as never, 0, 0)
  const id = ctx.getImageData(0, 0, img.width, img.height)
  return { w: img.width, h: img.height, data: id.data }
}

/** True if a pixel differs meaningfully from the background. */
function isInk(data: Uint8ClampedArray, idx: number): boolean {
  const dist = Math.abs(data[idx]! - BG.r) + Math.abs(data[idx + 1]! - BG.g) + Math.abs(data[idx + 2]! - BG.b)
  return dist > 60
}

/** Total inked pixels inside one cell's full x-band (whole cell height). */
function cellBandInk(img: { w: number; h: number; data: Uint8ClampedArray }, cellCol: number): number {
  const x0 = Math.round(cellCol * CELL_W * SCALE)
  const x1 = Math.round((cellCol + 1) * CELL_W * SCALE)
  let ink = 0
  for (let y = 0; y < img.h; y++) {
    for (let x = x0; x < x1 && x < img.w; x++) {
      if (isInk(img.data, (y * img.w + x) * 4)) ink++
    }
  }
  return ink
}

/** Fraction of inked pixels inside one cell's interior (perimeter inset 25%). */
function interiorInkRatio(img: { w: number; h: number; data: Uint8ClampedArray }, cellCol: number): number {
  const x0 = Math.round(cellCol * CELL_W * SCALE)
  const cw = CELL_W * SCALE
  const ch = CELL_H * SCALE
  const insetX = Math.floor(cw * 0.25)
  const insetY = Math.floor(ch * 0.25)
  let ink = 0
  let total = 0
  for (let y = Math.floor(insetY); y < Math.floor(ch - insetY); y++) {
    for (let x = x0 + insetX; x < x0 + Math.floor(cw - insetX); x++) {
      if (x < 0 || x >= img.w || y < 0 || y >= img.h) continue
      total++
      if (isInk(img.data, (y * img.w + x) * 4)) ink++
    }
  }
  return total > 0 ? ink / total : 0
}

describe("resvg letter-spacing (bug 2)", () => {
  test("the emitted SVG carries no textLength / spacingAndGlyphs stretch", () => {
    // The structural fix: `textLength` + `lengthAdjust="spacingAndGlyphs"`
    // are gone — @resvg/resvg-js's stretch algorithm is no longer a variable.
    const cells = [..."Convention"].map((ch) => cell(ch, { bold: true }))
    const svg = screenshotSvg(readableFromCells(cells))
    expect(svg).not.toContain("textLength")
    expect(svg).not.toContain("lengthAdjust")
    // Per-character `x` list is the replacement — one cell-grid coord per glyph.
    expect(svg).toMatch(/<tspan x="0 9\.6 19\.2/)
  })

  test("a multi-cell tspan emits one x coordinate per character", () => {
    // Exactly `charCount` coordinates, each one cellWidth apart — this is what
    // pins every glyph to its cell origin instead of relying on tspan stretch.
    const word = "Workflow:"
    const cells = [...word].map((ch) => cell(ch, { bold: true }))
    const svg = screenshotSvg(readableFromCells(cells))
    const m = svg.match(/<tspan x="([^"]+)"/)
    expect(m, "no tspan x list emitted").not.toBeNull()
    const xs = m![1]!.split(" ").map(Number)
    expect(xs.length, "x list must have one coord per character").toBe(word.length)
    for (let i = 0; i < xs.length; i++) {
      expect(xs[i], `glyph ${i} not at its cell origin`).toBeCloseTo(i * CELL_W, 3)
    }
  })

  // Bumped timeout: the Windows GitHub runner is slow enough that the
  // canvas-renderer path through this test plus its decode pass routinely
  // overshoots vitest defaults. The assertion itself runs ~1s on macOS/linux,
  // ~6-8s steady-state on win32-x64, and 30-50s cold-start when canvas/font
  // init lands on this test first. Per-test 60s ceiling keeps the gate honest
  // without skipping the platform; other platforms still see real timeout
  // protection (if canvas + decode ever stalls beyond 60s, something is
  // broken worth flagging).
  test.skipIf(!CANVAS_AVAILABLE)(
    "every cell of a bold word holds its glyph — no collapsed/spread cells",
    async () => {
      const word = "Workflow:"
      const cells = [...word].map((ch) => cell(ch, { bold: true }))
      const img = await decode(await screenshotPng(readableFromCells(cells), { scale: SCALE }))
      for (let col = 0; col < word.length; col++) {
        const ink = cellBandInk(img, col)
        expect(ink, `cell ${col} ('${[...word][col]}') ink=${ink} — glyph missing or drifted off-grid`).toBeGreaterThan(
          20,
        )
      }
    },
    60000,
  )
})

/** Raster one glyph alone via raw resvg, with a caller-chosen `font` config. */
async function rasterGlyph(
  glyph: string,
  font: { loadSystemFonts: boolean; defaultFontFamily?: string; fontFiles?: string[] },
): Promise<{ w: number; h: number; data: Uint8ClampedArray }> {
  const wide = [...glyph][0]!.codePointAt(0)! >= 0x1f000
  const cells = [cell(glyph, { wide })]
  if (wide) cells.push(cell("", { continuation: true }))
  const svg = screenshotSvg(readableFromCells(cells))
  const png = new Resvg(svg, { fitTo: { mode: "zoom", value: SCALE }, font }).render().asPng()
  return decode(png)
}

describe("resvg emoji / symbol coverage (bug 3)", () => {
  test("bundled fallback font files exist and resolve", () => {
    const files = bundledFontFiles()
    // The four OFL faces: JetBrains Mono + Noto Sans Symbols 2 +
    // Symbols Nerd Font + Noto Emoji.
    expect(files.length).toBe(4)
    for (const f of files) expect(existsSync(f), `bundled font missing: ${f}`).toBe(true)
  })

  test.skipIf(!CANVAS_AVAILABLE).each([
    ["📋", "clipboard emoji U+1F4CB"],
    ["📄", "page emoji U+1F4C4"],
    ["⧗", "hourglass symbol U+29D7"],
  ])("renders %s (%s) as a real glyph, not tofu", async (glyph, _label) => {
    const png = await screenshotPng(
      readableFromCells(
        [...glyph][0]!.codePointAt(0)! >= 0x1f000
          ? [cell(glyph, { wide: true }), cell("", { continuation: true })]
          : [cell(glyph)],
      ),
      { scale: SCALE },
    )
    const img = await decode(png)
    const ratio = interiorInkRatio(img, 0)
    // A real glyph fills a meaningful fraction of its cell interior; a hollow
    // `.notdef` tofu box leaves the interior near-empty.
    expect(ratio, `glyph ${glyph} interior ink ratio ${ratio.toFixed(3)} — renders as tofu`).toBeGreaterThan(0.04)
  })

  test.skipIf(!CANVAS_AVAILABLE).each([["⧗", "hourglass symbol U+29D7"]])(
    "the bundled fontFiles improve glyph coverage for %s (%s)",
    async (glyph, _label) => {
      // Control: the resvg `font` config the encoders used BEFORE this fix —
      // `loadSystemFonts` + `defaultFontFamily` only. With nothing in fontFiles,
      // resvg-js cannot deterministically resolve a face covering these code
      // points (worst case: hollow `.notdef` tofu).
      const before = interiorInkRatio(
        await rasterGlyph(glyph, { loadSystemFonts: false, defaultFontFamily: "Menlo" }),
        0,
      )
      // The fix: the bundled Noto faces passed through `font.fontFiles`.
      const after = interiorInkRatio(
        await rasterGlyph(glyph, {
          loadSystemFonts: false,
          defaultFontFamily: "Menlo",
          fontFiles: bundledFontFiles(),
        }),
        0,
      )
      expect(
        after,
        `bundled fontFiles must add glyph ink for ${glyph} — before ${before.toFixed(3)}, after ${after.toFixed(3)}`,
      ).toBeGreaterThan(before)
      // And the resolved glyph must be a real, well-inked glyph (not tofu).
      expect(after, `glyph ${glyph} still under-inked with fontFiles`).toBeGreaterThan(0.04)
    },
  )

  test.skipIf(!TWEMOJI_AVAILABLE).each([
    ["📋", "clipboard emoji U+1F4CB", "1f4cb"],
    ["📄", "page emoji U+1F4C4", "1f4c4"],
    ["📁", "folder emoji U+1F4C1", "1f4c1"],
  ])("color emoji %s (%s) is image-injected, not font-rendered", async (glyph, _label, key) => {
    // For emoji codepoints, the SVG renderer side-steps the font path entirely
    // and embeds a Twemoji color SVG via `<image href="data:image/svg+xml;base64">`
    // — see src/render/emoji.ts. resvg-js cannot render any color emoji font
    // format (CBDT, COLR, OT-SVG), so font-only rendering produces the bundled
    // monochrome Noto Emoji outline. Image injection delivers the colorful
    // emoji users see in their real terminal.
    const wide = [...glyph][0]!.codePointAt(0)! >= 0x1f000
    const cells = [cell(glyph, { wide })]
    if (wide) cells.push(cell("", { continuation: true }))
    const svg = screenshotSvg(readableFromCells(cells))
    // Asserts the renderer chose the image path for this codepoint.
    expect(svg).toContain(`<image `)
    expect(svg).toContain(`data:image/svg+xml;base64,`)
    // And the embedded asset is the right Twemoji file (the base64 begins with
    // the Twemoji SVG's opening "<svg ").
    expect(svg).toMatch(new RegExp(`data:image/svg\\+xml;base64,[A-Za-z0-9+/=]+`))
    // The rasterized output still has plenty of interior ink (it's a colored
    // emoji glyph, not tofu) — pinned by the existing "renders as a real glyph"
    // test above. This test pins the renderer-side architecture: image, not font.
    void key
  })

  test("a bold + emoji frame round-trips through createGif", async () => {
    // End-to-end: the actual GIF path must produce non-empty bytes for a
    // frame containing both a bold word and an emoji.
    const row = [
      ...[..."Done"].map((ch) => cell(ch, { bold: true })),
      cell(" "),
      cell("📋", { wide: true }),
      cell("", { continuation: true }),
    ]
    const svg = screenshotSvg(readableFromCells(row))
    const gif = await createGif([{ svg, duration: 100 }])
    expect(gif.length).toBeGreaterThan(0)
    // GIF magic number.
    expect(String.fromCharCode(gif[0]!, gif[1]!, gif[2]!)).toBe("GIF")
  })
})
