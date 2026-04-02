/**
 * Animation output format support for termless.
 *
 * Convenience functions for encoding animation frames in multiple formats.
 * Individual encoders are also exported directly for fine-grained control.
 */

export type { AnimationFrame, AnimationOptions, AnimationFormat } from "./types.ts"
export { createAnimatedSvg } from "./animated-svg.ts"
export { createGif } from "./gif.ts"
export { createApng } from "./apng.ts"

import type { AnimationFrame, AnimationFormat, AnimationOptions } from "./types.ts"
import { createAnimatedSvg } from "./animated-svg.ts"

/**
 * Render animation frames in the specified format.
 *
 * - `"svg"` → animated SVG string (CSS keyframes, synchronous)
 * - `"gif"` → animated GIF Uint8Array (requires gifenc + @resvg/resvg-js)
 * - `"apng"` → animated PNG Uint8Array (requires upng-js + @resvg/resvg-js)
 */
export async function renderAnimation(
  frames: AnimationFrame[],
  format: AnimationFormat,
  options?: AnimationOptions & { scale?: number },
): Promise<Uint8Array | string> {
  switch (format) {
    case "svg":
      return createAnimatedSvg(frames, options)
    case "gif": {
      const { createGif } = await import("./gif.ts")
      return createGif(frames, options)
    }
    case "apng": {
      const { createApng } = await import("./apng.ts")
      return createApng(frames, options)
    }
    default:
      throw new Error(`Unsupported animation format: ${format}`)
  }
}

/** Detect animation format from a filename extension. */
export function detectFormat(filename: string): AnimationFormat {
  if (filename.endsWith(".svg")) return "svg"
  if (filename.endsWith(".gif")) return "gif"
  if (filename.endsWith(".apng") || filename.endsWith(".png")) return "apng"
  throw new Error(`Unknown animation format for: ${filename}`)
}
