import { describe, expect, it } from "vitest"
import { createGif } from "../../src/animation/gif.ts"
import type { AnimationFrame } from "../../src/animation/types.ts"

const frame1: AnimationFrame = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="#1e1e1e"/><text x="10" y="30" fill="#d4d4d4" font-family="monospace" font-size="14">Hello</text></svg>',
  duration: 500,
}

const frame2: AnimationFrame = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="#1e1e1e"/><text x="10" y="30" fill="#00ff00" font-family="monospace" font-size="14">World</text></svg>',
  duration: 500,
}

describe("createGif", () => {
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
})
