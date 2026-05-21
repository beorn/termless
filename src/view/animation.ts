/**
 * Animation output format support for termless.
 *
 * Convenience functions for encoding animation frames in multiple formats.
 * Individual encoders are also exported directly for fine-grained control.
 */

export type { AnimationFrame, AnimationOptions, AnimationFormat } from "./animation-types.ts"
export { createAnimatedSvg } from "./animated-svg.ts"
export { createGif } from "./gif.ts"
export { createApng } from "./apng.ts"
// Recording-domain bridge (Phase 2): derive animation frames from a Recording.
export { recordingToPngFrames, recordingToAnimationFrames } from "./from-recording.ts"
export type { FromRecordingOptions } from "./from-recording.ts"

import type { AnimationFrame, AnimationFormat, AnimationOptions } from "./animation-types.ts"
import { createAnimatedSvg } from "./animated-svg.ts"
import type { RendererKind } from "./rasterizer.ts"

/**
 * Render animation frames in the specified format.
 *
 * - `"svg"` → animated SVG string (CSS keyframes, synchronous — no renderer)
 * - `"gif"` → animated GIF Uint8Array (gifenc + the `options.renderer` raster path)
 * - `"apng"` → animated PNG Uint8Array (upng-js + the `options.renderer` raster path)
 */
export async function renderAnimation(
  frames: AnimationFrame[],
  format: AnimationFormat,
  options?: AnimationOptions & { scale?: number; renderer?: RendererKind },
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
