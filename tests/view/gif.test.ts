import { afterEach, describe, expect, it, vi } from "vitest"
import { createGif } from "../../src/view/gif.ts"
import type { AnimationFrame } from "../../src/view/animation-types.ts"

const frame1: AnimationFrame = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="#1e1e1e"/><text x="10" y="30" fill="#d4d4d4" font-family="monospace" font-size="14">Hello</text></svg>',
  duration: 500,
}

const frame2: AnimationFrame = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="#1e1e1e"/><text x="10" y="30" fill="#00ff00" font-family="monospace" font-size="14">World</text></svg>',
  duration: 500,
}

describe("createGif", () => {
  afterEach(() => {
    vi.doUnmock("../../src/view/rasterizer.ts")
    vi.resetModules()
  })

  it("produces valid GIF for 2 frames", async () => {
    const result = await createGif([frame1, frame2], { scale: 1 })

    // GIF89a magic bytes
    expect(result[0]).toBe(0x47) // G
    expect(result[1]).toBe(0x49) // I
    expect(result[2]).toBe(0x46) // F
    expect(result[3]).toBe(0x38) // 8
    expect(result[4]).toBe(0x39) // 9
    expect(result[5]).toBe(0x61) // a

    // Should have reasonable size (not empty, not huge)
    expect(result.byteLength).toBeGreaterThan(100)
    expect(result.byteLength).toBeLessThan(100_000)
  })

  it("produces valid GIF for a single frame", async () => {
    const result = await createGif([frame1], { scale: 1 })

    // GIF89a magic bytes
    expect(result[0]).toBe(0x47) // G
    expect(result[1]).toBe(0x49) // I
    expect(result[2]).toBe(0x46) // F

    expect(result.byteLength).toBeGreaterThan(100)
  })

  it("throws on empty frames array", async () => {
    await expect(createGif([])).rejects.toThrow("at least one frame")
  })

  it("inter-frame delta encoding keeps repeated frames cheap", async () => {
    // 20 identical frames: after frame 0 every frame is an all-transparent
    // delta, which LZW-compresses to almost nothing. Without delta encoding
    // each frame would re-store the full indexed bitmap. Pin the size win:
    // 20 identical frames must stay well under a per-frame full-bitmap budget.
    const many: AnimationFrame[] = Array.from({ length: 20 }, () => ({ ...frame1 }))
    const result = await createGif(many, { scale: 1 })
    // A single 100×50 frame's indexed bitmap is ~5000 bytes pre-LZW; 20 of
    // them un-delta'd would be tens of KB. Delta-encoded, the 19 repeats add
    // near-nothing — assert the whole thing stays small.
    expect(result.byteLength).toBeLessThan(8_000)
  }, 15_000)

  it("uses cell-native rasterization when chrome is present and a snapshot is available", async () => {
    const calls = { svg: 0, cells: 0 }
    const solidBitmap = (width: number, height: number, rgba: [number, number, number, number]) => {
      const pixels = new Uint8Array(width * height * 4)
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = rgba[0]
        pixels[i + 1] = rgba[1]
        pixels[i + 2] = rgba[2]
        pixels[i + 3] = rgba[3]
      }
      return { pixels, width, height }
    }

    vi.doMock("../../src/view/rasterizer.ts", () => ({
      selectRasterizer: async () => ({
        kind: "swash",
        rasterize: async () => {
          calls.svg++
          return solidBitmap(4, 4, [200, 0, 0, 255])
        },
        toPng: async () => new Uint8Array(),
        rasterizeCells: async () => {
          calls.cells++
          return solidBitmap(2, 2, [0, 200, 0, 255])
        },
      }),
    }))

    const { createGif: createGifWithMockRasterizer } = await import("../../src/view/gif.ts")
    const frame: AnimationFrame = {
      svg: [
        '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4">',
        '<g class="windowBar"></g>',
        '<g transform="translate(1, 1)"><text>📋</text></g>',
        "</svg>",
      ].join(""),
      snapshot: {} as AnimationFrame["snapshot"],
      duration: 100,
    }

    await createGifWithMockRasterizer([frame], { scale: 1, renderer: "swash" })

    expect(calls.svg).toBeGreaterThan(0)
    expect(calls.cells).toBe(1)
  })
})
