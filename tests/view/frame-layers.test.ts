import { describe, expect, test } from "vitest"
import { frameLayers, rasterizeFrameLayers, type AnimationFrame, type FrameLayer } from "../../src/view/animation.ts"
import type { RasterBitmap, Rasterizer } from "../../src/view/rasterizer.ts"

function solidBitmap(width: number, height: number, rgba: [number, number, number, number]): RasterBitmap {
  const pixels = new Uint8Array(width * height * 4)
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = rgba[0]
    pixels[i + 1] = rgba[1]
    pixels[i + 2] = rgba[2]
    pixels[i + 3] = rgba[3]
  }
  return { pixels, width, height }
}

function pixelAt(bitmap: RasterBitmap, x: number, y: number): [number, number, number, number] {
  const i = (y * bitmap.width + x) * 4
  return [bitmap.pixels[i]!, bitmap.pixels[i + 1]!, bitmap.pixels[i + 2]!, bitmap.pixels[i + 3]!]
}

const snapshot = {} as AnimationFrame["snapshot"]

function frameWithChrome(): AnimationFrame {
  return {
    svg: [
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4">',
      '<g class="windowBar"></g>',
      '<g transform="translate(1, 1)"><text>🌈</text></g>',
      "</svg>",
    ].join(""),
    snapshot,
    duration: 100,
  }
}

describe("frame layers", () => {
  test("projects legacy snapshot + chrome frames into chrome then cells layers", () => {
    const layers = frameLayers(frameWithChrome())

    expect(layers.map((layer) => layer.kind)).toEqual(["chrome", "cells"])
    expect(layers[1]).toMatchObject({ kind: "cells", offset: { x: 1, y: 1 } })
  })

  test("projects legacy snapshot-only frames into a cells layer", () => {
    const layers = frameLayers({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>plain</text></svg>',
      snapshot,
      duration: 100,
    })

    expect(layers).toHaveLength(1)
    expect(layers[0]).toMatchObject({ kind: "cells" })
  })

  test("rejects explicit empty layer stacks", () => {
    expect(() =>
      frameLayers({
        svg: "<svg></svg>",
        layers: [],
        duration: 100,
      }),
    ).toThrow("at least one layer")
  })

  test("dispatches cells to the cell rasterizer and SVG layers to the SVG rasterizer", async () => {
    const calls: string[] = []
    const rasterizer: Rasterizer = {
      kind: "swash",
      async rasterize(svg) {
        calls.push(svg.includes("windowBar") ? "chrome" : "svg")
        return solidBitmap(4, 4, [200, 0, 0, 255])
      },
      async toPng() {
        return new Uint8Array()
      },
      async rasterizeCells() {
        calls.push("cells")
        return solidBitmap(2, 2, [0, 200, 0, 255])
      },
    }

    const bitmap = await rasterizeFrameLayers(frameWithChrome(), rasterizer, 1)

    expect(calls).toEqual(["chrome", "cells"])
    expect(pixelAt(bitmap, 0, 0)).toEqual([200, 0, 0, 255])
    expect(pixelAt(bitmap, 1, 1)).toEqual([0, 200, 0, 255])
  })

  test("legacy forceSvg bypasses layer projection", async () => {
    const calls: string[] = []
    const rasterizer: Rasterizer = {
      kind: "swash",
      async rasterize() {
        calls.push("svg")
        return solidBitmap(4, 4, [200, 0, 0, 255])
      },
      async toPng() {
        return new Uint8Array()
      },
      async rasterizeCells() {
        calls.push("cells")
        return solidBitmap(2, 2, [0, 200, 0, 255])
      },
    }

    await rasterizeFrameLayers(frameWithChrome(), rasterizer, 1, { forceSvg: true })

    expect(calls).toEqual(["svg"])
  })

  test("explicit decorations compose after lower layers", async () => {
    const layers: FrameLayer[] = [
      { kind: "svg", svg: "<svg>base</svg>" },
      { kind: "decoration", svg: "<svg>decor</svg>", offset: { x: 1, y: 0 } },
    ]
    const rasterizer: Rasterizer = {
      kind: "resvg",
      async rasterize(svg) {
        return svg.includes("decor") ? solidBitmap(1, 1, [0, 0, 240, 255]) : solidBitmap(3, 1, [200, 0, 0, 255])
      },
      async toPng() {
        return new Uint8Array()
      },
    }

    const bitmap = await rasterizeFrameLayers({ svg: "<svg>unused</svg>", layers, duration: 100 }, rasterizer, 1)

    expect(pixelAt(bitmap, 0, 0)).toEqual([200, 0, 0, 255])
    expect(pixelAt(bitmap, 1, 0)).toEqual([0, 0, 240, 255])
  })
})
