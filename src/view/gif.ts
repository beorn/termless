/**
 * Animated GIF encoder for termless.
 *
 * Converts SVG frames to an animated GIF using gifenc (pure JS, no binary deps)
 * for GIF encoding. SVG → pixel rasterization goes through the **renderer**
 * (`./rasterizer.ts`): `canvas` (`@napi-rs/canvas`, high fidelity) when its
 * native binding loads, `resvg` (`@resvg/resvg-js`) as the cross-platform
 * fallback. The renderer is *not* hardwired — a default `out.gif` gets
 * `canvas` fidelity when the binding is available.
 *
 * `gifenc` is an optional/lazy-loaded dependency — throws a clear error if
 * missing.
 */

// Module declarations live in ./gifenc.d.ts (picked up via tsconfig `include` glob).
import type { AnimationFrame, AnimationOptions } from "./animation-types.ts"
import { selectRasterizer, type RendererKind } from "./rasterizer.ts"

// Lazy-cached imports
let gifencModule: typeof import("gifenc") | null = null

async function loadGifenc() {
  if (gifencModule) return gifencModule
  try {
    gifencModule = await import("gifenc")
    return gifencModule
  } catch {
    throw new Error("createGif() requires gifenc. Install it:\n  bun add gifenc")
  }
}

/**
 * Encode animation frames as an animated GIF.
 *
 * Each SVG frame is rasterized to RGBA pixels via the selected renderer
 * (`options.renderer`, default `auto`), then quantized to 256 colors and
 * written to a GIF stream via gifenc.
 *
 * @param frames - SVG frames with durations
 * @param options - Animation options plus optional `scale` and `renderer`
 * @returns GIF file as Uint8Array
 */
export async function createGif(
  frames: AnimationFrame[],
  options?: AnimationOptions & { scale?: number; renderer?: RendererKind },
): Promise<Uint8Array> {
  if (frames.length === 0) {
    throw new Error("createGif requires at least one frame")
  }

  const [{ GIFEncoder, quantize, applyPalette }, rasterizer] = await Promise.all([
    loadGifenc(),
    selectRasterizer(options?.renderer ?? "auto"),
  ])

  const defaultDuration = options?.defaultDuration ?? 100
  const loop = options?.loop ?? 0
  const scale = options?.scale ?? 2

  const gif = GIFEncoder()

  // Cell-native path: a renderer that exposes `rasterizeCells` (swash) skips
  // the SVG round-trip when the frame carries a snapshot — that is what makes
  // color emoji and exact glyph coverage survive into the GIF.
  const rasterize = (frame: AnimationFrame) =>
    frame.snapshot && rasterizer.rasterizeCells
      ? rasterizer.rasterizeCells(frame.snapshot, scale)
      : rasterizer.rasterize(frame.svg, scale)

  // Shared global palette. A terminal recording's colour set barely changes
  // frame to frame (theme + ANSI + anti-alias blends), so quantizing a fresh
  // palette per frame — and re-embedding it in every frame — is pure bloat.
  // Quantize ONCE from a representative content-bearing frame and reuse it as
  // the GIF's global colour table. 255 colours, not 256: index 255 is
  // reserved as the inter-frame transparency marker (below).
  const sampleIdx = Math.floor(frames.length / 2)
  const sample = await rasterize(frames[sampleIdx]!)
  const palette = quantize(sample.pixels, 255)
  const TRANSPARENT_IDX = 255

  // Inter-frame diffing. Successive terminal frames differ in only a handful
  // of cells, so after frame 0 each frame is written as a *delta*: pixels
  // unchanged from the previous frame become the transparent index, and the
  // frame is composited over its predecessor (`dispose: 1` — do not dispose).
  // Long runs of the transparent index compress near-free under LZW — the
  // dominant GIF-size win for a recording.
  let prevIndexed: Uint8Array | null = null

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!
    const duration = frame.duration || defaultDuration

    const { pixels: rgba, width, height } = i === sampleIdx ? sample : await rasterize(frame)
    const indexed = applyPalette(rgba, palette)

    // Delta-encode against the previous frame when dimensions match.
    const canDiff = prevIndexed !== null && prevIndexed.length === indexed.length
    let frameData = indexed
    if (canDiff) {
      const delta = new Uint8Array(indexed.length)
      for (let p = 0; p < indexed.length; p++) {
        delta[p] = indexed[p] === prevIndexed![p] ? TRANSPARENT_IDX : indexed[p]!
      }
      frameData = delta
    }

    gif.writeFrame(frameData, width, height, {
      // Only the first frame carries the palette — it becomes the global
      // colour table; later frames reference it (no per-frame local table).
      palette: i === 0 ? palette : undefined,
      delay: duration,
      repeat: i === 0 ? (loop === 0 ? 0 : loop) : undefined,
      // Frames after the first are deltas: transparent pixels show the
      // composited prior frame through. `dispose: 1` keeps each frame in
      // place so the next delta lands on top of it.
      transparent: canDiff,
      transparentIndex: TRANSPARENT_IDX,
      dispose: 1,
    })

    // Compare the NEXT frame against this frame's full (un-delta'd) content.
    prevIndexed = indexed
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
