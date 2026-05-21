/**
 * Tiny PNG codec wrapper for the cross-backend compositor.
 *
 * Decode + encode via `upng-js` (already a `@termless/core` dependency, used
 * for PNG measurement in `./compare.ts`). No native `@napi-rs/canvas` needed
 * here — `@termless/core` stays dependency-light; the canvas/Skia stack lives
 * in `@termless/ghostty`.
 *
 * The compositor (`./compare-canvas.ts`) works in raw RGBA, so this module is
 * just the byte ⇄ pixel bridge.
 */

let upngModule: typeof import("upng-js") | null = null

async function loadUpngAsync() {
  if (upngModule) return upngModule
  upngModule = await import("upng-js")
  return upngModule
}

/** Synchronous upng access — the module is pure JS and resolves eagerly. */
function loadUpng(): typeof import("upng-js") {
  if (!upngModule) {
    // upng-js is CJS; require keeps decode/encode synchronous for the
    // pixel-pushing hot path in the compositor.
    upngModule = require("upng-js") as typeof import("upng-js")
  }
  return upngModule
}

/** A decoded raster — RGBA8, row-major, top-left origin. */
export interface RgbaImage {
  width: number
  height: number
  /** `width * height * 4` bytes, RGBA order. */
  data: Uint8Array
}

/** Decode PNG bytes to an RGBA raster. */
export function decodePngRgba(png: Uint8Array): RgbaImage {
  const UPNG = loadUpng()
  const buffer = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer
  const decoded = UPNG.decode(buffer)
  const frame = UPNG.toRGBA8(decoded)[0]
  if (!frame) throw new Error("decodePngRgba: PNG decode produced no RGBA frame")
  return { width: decoded.width, height: decoded.height, data: new Uint8Array(frame) }
}

/** Encode an RGBA raster to lossless PNG bytes (0 = no quantization). */
export function encodePng(img: RgbaImage): Uint8Array {
  const UPNG = loadUpng()
  const ab = img.data.buffer.slice(img.data.byteOffset, img.data.byteOffset + img.data.byteLength) as ArrayBuffer
  const encoded = UPNG.encode([ab], img.width, img.height, 0)
  return new Uint8Array(encoded)
}

/** Async warm-up — pre-loads the upng module so the first sync call is hot. */
export async function warmUpngCodec(): Promise<void> {
  await loadUpngAsync()
}
