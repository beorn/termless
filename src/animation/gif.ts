/**
 * Animated GIF encoder for termless.
 *
 * Converts SVG frames to an animated GIF using gifenc (pure JS, no binary deps)
 * for GIF encoding and @resvg/resvg-js for SVG→pixel rasterization.
 *
 * Both are optional/lazy-loaded dependencies — throws clear errors if missing.
 */

import type { AnimationFrame, AnimationOptions } from "./types.ts"

// Lazy-cached imports
let gifencModule: typeof import("gifenc") | null = null
let resvgModule: { Resvg: any } | null = null

async function loadGifenc() {
  if (gifencModule) return gifencModule
  try {
    gifencModule = await import("gifenc")
    return gifencModule
  } catch {
    throw new Error("createGif() requires gifenc. Install it:\n  bun add gifenc")
  }
}

async function loadResvg() {
  if (resvgModule) return resvgModule
  try {
    resvgModule = await import("@resvg/resvg-js")
    return resvgModule
  } catch {
    throw new Error("createGif() requires @resvg/resvg-js. Install it:\n  bun add @resvg/resvg-js")
  }
}

/**
 * Encode animation frames as an animated GIF.
 *
 * Each SVG frame is rasterized to RGBA pixels via @resvg/resvg-js,
 * then quantized to 256 colors and written to a GIF stream via gifenc.
 *
 * @param frames - SVG frames with durations
 * @param options - Animation options plus optional `scale` for rasterization
 * @returns GIF file as Uint8Array
 */
export async function createGif(
  frames: AnimationFrame[],
  options?: AnimationOptions & { scale?: number },
): Promise<Uint8Array> {
  if (frames.length === 0) {
    throw new Error("createGif requires at least one frame")
  }

  const [{ GIFEncoder, quantize, applyPalette }, { Resvg }] = await Promise.all([loadGifenc(), loadResvg()])

  const defaultDuration = options?.defaultDuration ?? 100
  const loop = options?.loop ?? 0
  const scale = options?.scale ?? 2

  const gif = GIFEncoder()

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!
    const duration = frame.duration || defaultDuration

    const resvg = new Resvg(frame.svg, {
      fitTo: { mode: "zoom" as const, value: scale },
    })
    const rendered = resvg.render()
    const rgba = new Uint8Array(rendered.pixels)
    const width = rendered.width
    const height = rendered.height

    const palette = quantize(rgba, 256)
    const indexed = applyPalette(rgba, palette)

    gif.writeFrame(indexed, width, height, {
      palette,
      delay: duration,
      repeat: i === 0 ? (loop === 0 ? 0 : loop) : undefined,
    })
  }

  gif.finish()
  return gif.bytesView()
}
