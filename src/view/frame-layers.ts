/**
 * Frame-layer projection and raster composition.
 *
 * Legacy animation frames carry one SVG plus an optional cell snapshot. This
 * module names the implicit layer stack so encoders can choose the best
 * rasterizer per layer without rediscovering chrome/snapshot heuristics.
 */

import type { AnimationFrame, FrameLayer, FrameLayerOffset } from "./animation-types.ts"
import type { RasterBitmap, Rasterizer } from "./rasterizer.ts"

export function svgHasChrome(svg: string): boolean {
  return /windowBar|windowTitle|<rect[^>]*rx="\d+"/.test(svg)
}

export function svgContentOffset(svg: string): FrameLayerOffset {
  const transforms = [...svg.matchAll(/<g[^>]*\btransform="translate\(\s*([\d.-]+)[,\s]+([\d.-]+)\s*\)"/g)]
  const contentTransform = transforms.at(-1)
  if (!contentTransform) return { x: 0, y: 0 }
  return {
    x: Number(contentTransform[1]),
    y: Number(contentTransform[2]),
  }
}

export function frameLayers(frame: AnimationFrame): readonly FrameLayer[] {
  if (frame.layers !== undefined) {
    if (frame.layers.length === 0) {
      throw new Error("AnimationFrame.layers requires at least one layer")
    }
    return frame.layers
  }

  if (!frame.snapshot) return [{ kind: "svg", svg: frame.svg }]

  if (!svgHasChrome(frame.svg)) {
    return [{ kind: "cells", snapshot: frame.snapshot, fallbackSvg: frame.svg }]
  }

  // Legacy chrome SVGs include both chrome and content. Until ChromeSpec is a
  // separate layer, keep that full SVG as the base and overlay cell-native
  // content at the SVG content transform.
  return [
    { kind: "chrome", svg: frame.svg },
    {
      kind: "cells",
      snapshot: frame.snapshot,
      offset: svgContentOffset(frame.svg),
      fallbackSvg: frame.svg,
    },
  ]
}

export function compositeBitmap(
  base: RasterBitmap,
  overlay: RasterBitmap,
  offset: FrameLayerOffset = { x: 0, y: 0 },
): RasterBitmap {
  const pixels = new Uint8Array(base.pixels)
  for (let y = 0; y < overlay.height; y++) {
    const dy = y + offset.y
    if (dy < 0 || dy >= base.height) continue
    for (let x = 0; x < overlay.width; x++) {
      const dx = x + offset.x
      if (dx < 0 || dx >= base.width) continue

      const si = (y * overlay.width + x) * 4
      const di = (dy * base.width + dx) * 4
      const srcAlpha = overlay.pixels[si + 3]! / 255
      if (srcAlpha <= 0) continue
      if (srcAlpha >= 1) {
        pixels[di] = overlay.pixels[si]!
        pixels[di + 1] = overlay.pixels[si + 1]!
        pixels[di + 2] = overlay.pixels[si + 2]!
        pixels[di + 3] = overlay.pixels[si + 3]!
        continue
      }

      const dstAlpha = pixels[di + 3]! / 255
      const outAlpha = srcAlpha + dstAlpha * (1 - srcAlpha)
      if (outAlpha <= 0) continue

      const dstWeight = (dstAlpha * (1 - srcAlpha)) / outAlpha
      const srcWeight = srcAlpha / outAlpha
      pixels[di] = Math.round(overlay.pixels[si]! * srcWeight + pixels[di]! * dstWeight)
      pixels[di + 1] = Math.round(overlay.pixels[si + 1]! * srcWeight + pixels[di + 1]! * dstWeight)
      pixels[di + 2] = Math.round(overlay.pixels[si + 2]! * srcWeight + pixels[di + 2]! * dstWeight)
      pixels[di + 3] = Math.round(outAlpha * 255)
    }
  }
  return { ...base, pixels }
}

function scaledOffset(offset: FrameLayerOffset | undefined, scale: number): FrameLayerOffset {
  if (!offset) return { x: 0, y: 0 }
  return {
    x: Math.round(offset.x * scale),
    y: Math.round(offset.y * scale),
  }
}

function transparentBitmap(width: number, height: number): RasterBitmap {
  return { pixels: new Uint8Array(width * height * 4), width, height }
}

async function rasterizeLayer(
  layer: FrameLayer,
  rasterizer: Rasterizer,
  scale: number,
  forceSvg: boolean,
): Promise<RasterBitmap> {
  if (layer.kind === "cells") {
    if (!forceSvg && rasterizer.rasterizeCells) {
      return rasterizer.rasterizeCells(layer.snapshot, scale)
    }
    if (layer.fallbackSvg) return rasterizer.rasterize(layer.fallbackSvg, scale)
    throw new Error("Cannot rasterize cells layer without rasterizeCells or fallbackSvg")
  }

  return rasterizer.rasterize(layer.svg, scale)
}

export async function rasterizeFrameLayers(
  frame: AnimationFrame,
  rasterizer: Rasterizer,
  scale: number,
  options: { forceSvg?: boolean } = {},
): Promise<RasterBitmap> {
  const forceSvg = options.forceSvg === true
  if (frame.layers === undefined && (forceSvg || (frame.snapshot && !rasterizer.rasterizeCells))) {
    return rasterizer.rasterize(frame.svg, scale)
  }

  const layers = frameLayers(frame)
  let output: RasterBitmap | null = null

  for (const layer of layers) {
    const bitmap = await rasterizeLayer(layer, rasterizer, scale, forceSvg)
    const offset = scaledOffset(layer.offset, scale)
    if (output === null) {
      output =
        offset.x === 0 && offset.y === 0
          ? bitmap
          : compositeBitmap(transparentBitmap(bitmap.width + offset.x, bitmap.height + offset.y), bitmap, offset)
      continue
    }
    output = compositeBitmap(output, bitmap, offset)
  }

  if (output === null) {
    throw new Error("AnimationFrame.layers requires at least one layer")
  }
  return output
}
