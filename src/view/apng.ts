/**
 * Animated PNG (APNG) encoder for termless.
 *
 * Converts SVG frames to an APNG using upng-js for APNG encoding. SVG → pixel
 * rasterization goes through the **renderer** (`./rasterizer.ts`): `canvas`
 * (`@napi-rs/canvas`) when its binding loads, `resvg` as the fallback.
 *
 * `upng-js` is an optional/lazy-loaded dependency — throws a clear error if
 * missing.
 */

// Module declarations live in ./upng.d.ts (picked up via tsconfig `include` glob).
import type { AnimationFrame, AnimationOptions } from "./animation-types.ts"
import { selectRasterizer, type RendererKind } from "./rasterizer.ts"

// Lazy-cached imports
let upngModule: typeof import("upng-js") | null = null

async function loadUpng() {
  if (upngModule) return upngModule
  try {
    upngModule = await import("upng-js")
    return upngModule
  } catch {
    throw new Error("createApng() requires upng-js. Install it:\n  bun add upng-js")
  }
}

/**
 * Encode animation frames as an animated PNG (APNG).
 *
 * Each SVG frame is rasterized to RGBA pixels via the selected renderer
 * (`options.renderer`, default `auto`), then combined into a single APNG file
 * via upng-js.
 *
 * @param frames - SVG frames with durations
 * @param options - Animation options plus optional `scale` and `renderer`
 * @returns APNG file as Uint8Array
 */
export async function createApng(
  frames: AnimationFrame[],
  options?: AnimationOptions & { scale?: number; renderer?: RendererKind },
): Promise<Uint8Array> {
  if (frames.length === 0) {
    throw new Error("createApng requires at least one frame")
  }

  const [UPNG, rasterizer] = await Promise.all([loadUpng(), selectRasterizer(options?.renderer ?? "auto")])

  const defaultDuration = options?.defaultDuration ?? 100
  const scale = options?.scale ?? 2

  const rgbaBuffers: ArrayBuffer[] = []
  const delays: number[] = []
  let width = 0
  let height = 0

  for (const frame of frames) {
    const duration = frame.duration || defaultDuration

    // Cell-native path (swash): skip the SVG round-trip when a snapshot exists.
    const rendered =
      frame.snapshot && rasterizer.rasterizeCells
        ? await rasterizer.rasterizeCells(frame.snapshot, scale)
        : await rasterizer.rasterize(frame.svg, scale)

    // Use first frame's dimensions as the canvas size
    if (width === 0) {
      width = rendered.width
      height = rendered.height
    }

    rgbaBuffers.push(rendered.pixels.buffer as ArrayBuffer)
    delays.push(duration)
  }

  // upng-js encode: cnum=0 means lossless (full RGBA, no quantization)
  const apng = UPNG.encode(rgbaBuffers, width, height, 0, delays)
  return new Uint8Array(apng)
}
