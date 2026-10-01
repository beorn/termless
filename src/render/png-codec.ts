/**
 * Shared, lazily loaded PNG codec for rendering, comparison and animation.
 * Keep synchronous first use available to the public pixel compositor.
 */

import { createRequire } from "node:module"

type PngCodec = typeof import("upng-js")
const require = createRequire(import.meta.url)
let upngModule: PngCodec | null = null

function hasCodec(value: unknown): value is PngCodec {
  return (
    value !== null &&
    typeof value === "object" &&
    "decode" in value &&
    typeof value.decode === "function" &&
    "encode" in value &&
    typeof value.encode === "function" &&
    "toRGBA8" in value &&
    typeof value.toRGBA8 === "function"
  )
}

/** One codec owner; resolve CJS and default-export shapes once, on first use. */
export function pngCodec(): PngCodec {
  if (upngModule) return upngModule
  const resolved: unknown = require("upng-js")
  const defaultExport =
    resolved !== null && typeof resolved === "object" && "default" in resolved ? resolved.default : undefined
  if (hasCodec(resolved)) upngModule = resolved
  else if (hasCodec(defaultExport)) upngModule = defaultExport
  else {
    const keys = resolved !== null && typeof resolved === "object" ? Object.keys(resolved).join(", ") : typeof resolved
    const defaultKeys =
      defaultExport !== null && typeof defaultExport === "object"
        ? Object.keys(defaultExport).join(", ")
        : typeof defaultExport
    throw new Error(
      `Invalid upng-js module: expected decode, encode and toRGBA8 functions; namespace keys: ${keys}; default keys: ${defaultKeys}`,
    )
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
  const UPNG = pngCodec()
  const buffer = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer
  const decoded = UPNG.decode(buffer)
  const frame = UPNG.toRGBA8(decoded)[0]
  if (!frame) throw new Error("decodePngRgba: PNG decode produced no RGBA frame")
  return { width: decoded.width, height: decoded.height, data: new Uint8Array(frame) }
}

/** Encode an RGBA raster to lossless PNG bytes (0 = no quantization). */
export function encodePng(img: RgbaImage): Uint8Array {
  const UPNG = pngCodec()
  const ab = img.data.buffer.slice(img.data.byteOffset, img.data.byteOffset + img.data.byteLength) as ArrayBuffer
  const encoded = UPNG.encode([ab], img.width, img.height, 0)
  return new Uint8Array(encoded)
}
