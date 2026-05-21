/**
 * Animated GIF encoder for termless.
 *
 * Converts SVG frames to an animated GIF using gifenc (pure JS, no binary deps)
 * for GIF encoding and @resvg/resvg-js for SVG→pixel rasterization.
 *
 * Both are optional/lazy-loaded dependencies — throws clear errors if missing.
 */

// Module declarations live in ./gifenc.d.ts (picked up via tsconfig `include` glob).
import type { AnimationFrame, AnimationOptions } from "./animation-types.ts"

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
      font: { loadSystemFonts: true, defaultFontFamily: "Menlo" },
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

/** One PNG-backed animation frame: pre-rasterized bytes + a display duration. */
export interface PngFrame {
  /** PNG bytes of this frame. */
  png: Uint8Array
  /** Display duration in milliseconds. */
  duration: number
}

/**
 * Encode already-rasterized PNG frames as an animated GIF.
 *
 * Unlike {@link createGif}, the frames are pre-rendered PNGs — no SVG round-
 * trip, no `@resvg/resvg-js`. Used by the cross-backend compositor
 * (`../tape/compare-canvas.ts`), whose frames are composed PNGs.
 *
 * All frames are expected to share dimensions (the compositor guarantees this
 * by time-syncing the panel layout); a mismatched frame is letterboxed onto
 * the first frame's canvas size.
 */
export async function createGifFromPngs(
  frames: PngFrame[],
  options?: AnimationOptions & { decodePng?: (png: Uint8Array) => { width: number; height: number; data: Uint8Array } },
): Promise<Uint8Array> {
  if (frames.length === 0) {
    throw new Error("createGifFromPngs requires at least one frame")
  }
  const { GIFEncoder, quantize, applyPalette } = await loadGifenc()
  const defaultDuration = options?.defaultDuration ?? 100
  const loop = options?.loop ?? 0

  // Decoder: caller-supplied (the compositor passes its upng codec) or upng.
  const decode =
    options?.decodePng ??
    (await (async () => {
      const { decodePngRgba } = await import("../recording/tape/png-codec.ts")
      return decodePngRgba
    })())

  const gif = GIFEncoder()
  let baseW = 0
  let baseH = 0

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!
    const decoded = decode(frame.png)
    if (i === 0) {
      baseW = decoded.width
      baseH = decoded.height
    }
    let rgba = decoded.data
    let width = decoded.width
    let height = decoded.height
    if (width !== baseW || height !== baseH) {
      // Letterbox onto the base canvas (top-left aligned).
      const padded = new Uint8Array(baseW * baseH * 4)
      for (let y = 0; y < Math.min(height, baseH); y++) {
        for (let x = 0; x < Math.min(width, baseW); x++) {
          const si = (y * width + x) * 4
          const di = (y * baseW + x) * 4
          padded[di] = rgba[si]!
          padded[di + 1] = rgba[si + 1]!
          padded[di + 2] = rgba[si + 2]!
          padded[di + 3] = rgba[si + 3]!
        }
      }
      rgba = padded
      width = baseW
      height = baseH
    }
    const palette = quantize(rgba, 256)
    const indexed = applyPalette(rgba, palette)
    gif.writeFrame(indexed, width, height, {
      palette,
      delay: frame.duration || defaultDuration,
      repeat: i === 0 ? (loop === 0 ? 0 : loop) : undefined,
    })
  }

  gif.finish()
  return gif.bytesView()
}
