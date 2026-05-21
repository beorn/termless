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
 * - **`swash`** — `@termless/swash-render` (pure-Rust swash via napi-rs).
 *   Browser-grade text + **color emoji** (sbix / CBDT / COLR), ~1.3 MB native
 *   binding. swash rasterizes the *cell grid* directly (no SVG round-trip), so
 *   its `Rasterizer` exposes {@link Rasterizer.rasterizeCells}; the SVG-input
 *   methods delegate to `resvg` (swash does not parse SVG). The cells path is
 *   the fidelity win — `Terminal.screenshot({ renderer: "swash" })` uses it.
 *
 * `auto` (the default) uses `canvas` when its native binding loads, and falls
 * back to `resvg` otherwise. `--renderer` is a *force* override — the common
 * case never touches it.
 *
 * Raster outputs (`.png` / `.gif` / `.apng`) consult the renderer. `.svg` is
 * vector and `.html` defers to the browser canvas — neither rasterizes
 * server-side, so neither involves a renderer.
 */

import { bundledFontFiles, bundledFontsDir, BUNDLED_FONTS } from "../render/fonts.ts"
import { existsSync } from "node:fs"
import { join } from "node:path"

/** How a raster frame is rasterized from SVG. */
export type RendererKind = "canvas" | "resvg" | "swash" | "auto"

/** A terminal whose cell grid a {@link Rasterizer} can read directly. */
export type CellGridSource = import("../terminal/types.ts").TerminalReadable

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
  readonly kind: "canvas" | "resvg" | "swash"
  /** Rasterize `svg` at `scale`× into an RGBA bitmap. */
  rasterize(svg: string, scale: number): Promise<RasterBitmap>
  /** Rasterize `svg` at `scale`× directly into PNG bytes. */
  toPng(svg: string, scale: number): Promise<Uint8Array>
  /**
   * Rasterize a terminal's cell grid directly into an RGBA bitmap — no SVG
   * round-trip. Present only on the `swash` renderer, whose fidelity edge
   * (color emoji) depends on consuming cells, not a flattened SVG.
   */
  rasterizeCells?(terminal: CellGridSource, scale: number): Promise<RasterBitmap>
  /** Rasterize a terminal's cell grid directly into PNG bytes. */
  cellsToPng?(terminal: CellGridSource, scale: number): Promise<Uint8Array>
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
  const mod = (await import("@napi-rs/canvas")) as {
    createCanvas: any
    Image: any
    GlobalFonts: { registerFromPath(path: string, family: string): void }
  }
  // Register the bundled fallback faces process-wide BEFORE any SVG with text
  // is rasterized — without these, `@napi-rs/canvas` falls back to system
  // fonts and every symbol / emoji / box-drawing glyph renders as tofu. The
  // `resvg` rasterizer wires the same faces via `font.fontFiles`; this is the
  // canvas-side equivalent. Idempotent (registerFromPath is keyed by family).
  const dir = bundledFontsDir()
  for (const { file, family } of BUNDLED_FONTS) {
    const path = join(dir, file)
    if (existsSync(path)) mod.GlobalFonts.registerFromPath(path, family)
  }
  canvasModule = mod
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
// swash renderer (@termless/swash-render — pure-Rust swash via napi-rs)
// =============================================================================

type SwashModule = typeof import("../../packages/swash-render/src/index.ts")

let swashModule: SwashModule | null = null

async function loadSwash(): Promise<SwashModule> {
  if (swashModule) return swashModule
  const mod = (await import("../../packages/swash-render/src/index.ts")) as SwashModule
  // Probe the native binding now so `selectRasterizer` can fail fast.
  if (!mod.swashRenderAvailable()) {
    throw new Error("@termless/swash-render native binding is not built")
  }
  swashModule = mod
  return mod
}

/**
 * The swash rasterizer. Its fidelity edge — color emoji — lives in the
 * **cells path** ({@link Rasterizer.rasterizeCells}); swash does not parse
 * SVG, so the SVG-input methods delegate to `resvg` as a faithful fallback
 * for the SVG-based gif / apng pipelines.
 */
async function createSwashRasterizer(mod: SwashModule): Promise<Rasterizer> {
  // resvg is the SVG-input fallback — swash only consumes the cell grid.
  const svgFallback = createResvgRasterizer(await loadResvg())
  const toBitmap = (terminal: CellGridSource, scale: number): RasterBitmap => {
    const s = Math.max(1, scale)
    const bmp = mod.renderCells(terminal, {
      cellWidth: 9.6 * s,
      cellHeight: 20 * s,
      fontSize: 16 * s,
      baseline: 20 * 0.78 * s,
    })
    return { pixels: new Uint8Array(bmp.pixels), width: bmp.width, height: bmp.height }
  }
  return {
    kind: "swash",
    rasterize: svgFallback.rasterize,
    toPng: svgFallback.toPng,
    async rasterizeCells(terminal, scale) {
      return toBitmap(terminal, scale)
    },
    async cellsToPng(terminal, scale) {
      const { pixels, width, height } = toBitmap(terminal, scale)
      const UPNG = (await import("upng-js")) as typeof import("upng-js")
      const ab = pixels.buffer.slice(pixels.byteOffset, pixels.byteOffset + pixels.byteLength) as ArrayBuffer
      return new Uint8Array(UPNG.encode([ab], width, height, 0))
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
  if (kind === "swash") {
    try {
      return await createSwashRasterizer(await loadSwash())
    } catch (e) {
      throw new Error(
        "--renderer swash requires the @termless/swash-render native binding. Build it:\n" +
          "  cd packages/swash-render && bun run build:native && bun run postbuild:native\n" +
          `\nOriginal error: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }
  // auto — prefer resvg, fall back to canvas.
  //
  // resvg is the safe default: handed the bundled fonts via `font.fontFiles`,
  // it resolves symbol / emoji / box-drawing glyphs with per-glyph fallback,
  // and renders a km board cleanly (rounded corners, sigil icons — verified).
  //
  // swash is NOT in the `auto` chain yet — it is the cell-native,
  // color-emoji renderer, but its font chain still lacks coverage for some
  // marker glyphs (they render as `.notdef` tofu — see
  // @km/termless/swash-font-coverage). Until that closes, swash is reachable
  // only via an explicit `--renderer swash`; promoting it to the `auto`
  // default would regress frames resvg already renders correctly.
  //
  // The `canvas` rasterizer is last — its `drawImage` SVG path ignores
  // registered fonts, so glyphs the system font lacks render as tofu.
  try {
    return createResvgRasterizer(await loadResvg())
  } catch {
    try {
      return createCanvasRasterizer(await loadCanvas())
    } catch {
      throw new Error(
        "createGif/screenshot requires a renderer. Install one:\n" +
          "  bun add @resvg/resvg-js  (resvg — cross-platform, default)\n" +
          "  bun add @napi-rs/canvas  (canvas — fallback)",
      )
    }
  }
}
