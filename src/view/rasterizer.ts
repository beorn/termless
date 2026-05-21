/**
 * The **renderer** — how termless turns an SVG terminal frame into pixels.
 *
 * A *renderer* rasterizes the vector SVG produced by `screenshotSvg` into an
 * RGBA bitmap. termless ships two:
 *
 * - **`canvas`** — `@napi-rs/canvas` (Skia). High fidelity — truecolor, real
 *   glyph shaping. Needs the native `@napi-rs/canvas` binding.
 * - **`resvg`** — `@resvg/resvg-js`. Cross-platform, no native binding,
 *   lower fidelity.
 *
 * `auto` (the default) uses `canvas` when its native binding loads, and falls
 * back to `resvg` otherwise. `--renderer` is a *force* override — the common
 * case never touches it.
 *
 * Raster outputs (`.png` / `.gif` / `.apng`) consult the renderer. `.svg` is
 * vector and `.html` defers to the browser canvas — neither rasterizes
 * server-side, so neither involves a renderer.
 */

import { bundledFontFiles } from "../render/fonts.ts"

/** How a raster frame is rasterized from SVG. */
export type RendererKind = "canvas" | "resvg" | "auto"

/** A rasterized RGBA bitmap. */
export interface RasterBitmap {
  /** RGBA pixel bytes, row-major, 4 bytes per pixel. */
  pixels: Uint8Array
  /** Bitmap width in pixels. */
  width: number
  /** Bitmap height in pixels. */
  height: number
}

/** A renderer: rasterizes one SVG frame into an RGBA bitmap. */
export interface Rasterizer {
  /** The concrete renderer this resolved to (`auto` collapses to one of these). */
  readonly kind: "canvas" | "resvg"
  /** Rasterize `svg` at `scale`× into an RGBA bitmap. */
  rasterize(svg: string, scale: number): Promise<RasterBitmap>
  /** Rasterize `svg` at `scale`× directly into PNG bytes. */
  toPng(svg: string, scale: number): Promise<Uint8Array>
}

// =============================================================================
// resvg renderer
// =============================================================================

let resvgModule: { Resvg: any } | null = null

async function loadResvg(): Promise<{ Resvg: any }> {
  if (resvgModule) return resvgModule
  resvgModule = (await import("@resvg/resvg-js")) as { Resvg: any }
  return resvgModule
}

function createResvgRasterizer(Resvg: { Resvg: any }): Rasterizer {
  const fontFiles = bundledFontFiles()
  const build = (svg: string, scale: number) =>
    new Resvg.Resvg(svg, {
      fitTo: { mode: "zoom" as const, value: scale },
      // Bundled emoji + symbol fallback faces — without these, resvg renders
      // emoji / rarer symbol code points as `.notdef` tofu.
      font: { loadSystemFonts: true, defaultFontFamily: "Menlo", fontFiles },
    })
  return {
    kind: "resvg",
    async rasterize(svg, scale) {
      const rendered = build(svg, scale).render()
      return { pixels: new Uint8Array(rendered.pixels), width: rendered.width, height: rendered.height }
    },
    async toPng(svg, scale) {
      return build(svg, scale).render().asPng()
    },
  }
}

// =============================================================================
// canvas renderer (@napi-rs/canvas — Skia)
// =============================================================================

let canvasModule: { createCanvas: any; Image: any } | null = null

async function loadCanvas(): Promise<{ createCanvas: any; Image: any }> {
  if (canvasModule) return canvasModule
  canvasModule = (await import("@napi-rs/canvas")) as { createCanvas: any; Image: any }
  return canvasModule
}

/** Read the intrinsic `width`/`height` from an SVG's root attributes. */
function svgIntrinsicSize(svg: string): { width: number; height: number } {
  const w = svg.match(/<svg[^>]*\bwidth="([\d.]+)"/)?.[1]
  const h = svg.match(/<svg[^>]*\bheight="([\d.]+)"/)?.[1]
  return { width: w ? Math.round(Number(w)) : 0, height: h ? Math.round(Number(h)) : 0 }
}

function createCanvasRasterizer(mod: { createCanvas: any; Image: any }): Rasterizer {
  const draw = (svg: string, scale: number) => {
    const img = new mod.Image()
    img.src = Buffer.from(svg)
    const intrinsic = svgIntrinsicSize(svg)
    const width = Math.max(1, Math.round((img.width || intrinsic.width) * scale))
    const height = Math.max(1, Math.round((img.height || intrinsic.height) * scale))
    const canvas = mod.createCanvas(width, height)
    const ctx = canvas.getContext("2d")
    ctx.drawImage(img, 0, 0, width, height)
    return { canvas, width, height }
  }
  return {
    kind: "canvas",
    async rasterize(svg, scale) {
      const { canvas, width, height } = draw(svg, scale)
      const data = canvas.getContext("2d").getImageData(0, 0, width, height).data
      return { pixels: new Uint8Array(data), width, height }
    },
    async toPng(svg, scale) {
      const { canvas } = draw(svg, scale)
      return new Uint8Array(canvas.toBuffer("image/png"))
    },
  }
}

// =============================================================================
// Selection
// =============================================================================

/**
 * Resolve a {@link RendererKind} to a concrete {@link Rasterizer}.
 *
 * - `canvas` — `@napi-rs/canvas`; throws a clear error if the binding is absent.
 * - `resvg` — `@resvg/resvg-js`; throws a clear error if it is absent.
 * - `auto` — `canvas` when its binding loads, else `resvg`.
 */
export async function selectRasterizer(kind: RendererKind = "auto"): Promise<Rasterizer> {
  if (kind === "canvas") {
    try {
      return createCanvasRasterizer(await loadCanvas())
    } catch {
      throw new Error("--renderer canvas requires @napi-rs/canvas. Install it:\n  bun add @napi-rs/canvas")
    }
  }
  if (kind === "resvg") {
    try {
      return createResvgRasterizer(await loadResvg())
    } catch {
      throw new Error("--renderer resvg requires @resvg/resvg-js. Install it:\n  bun add @resvg/resvg-js")
    }
  }
  // auto — prefer canvas, fall back to resvg.
  try {
    return createCanvasRasterizer(await loadCanvas())
  } catch {
    try {
      return createResvgRasterizer(await loadResvg())
    } catch {
      throw new Error(
        "createGif/screenshot requires a renderer. Install one:\n" +
          "  bun add @napi-rs/canvas   (canvas — high fidelity)\n" +
          "  bun add @resvg/resvg-js   (resvg — cross-platform)",
      )
    }
  }
}
