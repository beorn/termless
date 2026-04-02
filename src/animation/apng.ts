/**
 * Animated PNG (APNG) encoder for termless.
 *
 * Converts SVG frames to an APNG using upng-js for APNG encoding
 * and @resvg/resvg-js for SVG→pixel rasterization.
 *
 * Both are optional/lazy-loaded dependencies — throws clear errors if missing.
 */

import type { AnimationFrame, AnimationOptions } from "./types.ts"

// Lazy-cached imports
let upngModule: typeof import("upng-js") | null = null
let resvgModule: { Resvg: any } | null = null

async function loadUpng() {
  if (upngModule) return upngModule
  try {
    upngModule = await import("upng-js")
    return upngModule
  } catch {
    throw new Error("createApng() requires upng-js. Install it:\n  bun add upng-js")
  }
}

async function loadResvg() {
  if (resvgModule) return resvgModule
  try {
    resvgModule = await import("@resvg/resvg-js")
    return resvgModule
  } catch {
    throw new Error("createApng() requires @resvg/resvg-js. Install it:\n  bun add @resvg/resvg-js")
  }
}

/**
 * Encode animation frames as an animated PNG (APNG).
 *
 * Each SVG frame is rasterized to RGBA pixels via @resvg/resvg-js,
 * then combined into a single APNG file via upng-js.
 *
 * @param frames - SVG frames with durations
 * @param options - Animation options plus optional `scale` for rasterization
 * @returns APNG file as Uint8Array
 */
export async function createApng(
  frames: AnimationFrame[],
  options?: AnimationOptions & { scale?: number },
): Promise<Uint8Array> {
  if (frames.length === 0) {
    throw new Error("createApng requires at least one frame")
  }

  const [UPNG, { Resvg }] = await Promise.all([loadUpng(), loadResvg()])

  const defaultDuration = options?.defaultDuration ?? 100
  const scale = options?.scale ?? 2

  const rgbaBuffers: ArrayBuffer[] = []
  const delays: number[] = []
  let width = 0
  let height = 0

  for (const frame of frames) {
    const duration = frame.duration || defaultDuration

    const resvg = new Resvg(frame.svg, {
      fitTo: { mode: "zoom" as const, value: scale },
    })
    const rendered = resvg.render()

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
