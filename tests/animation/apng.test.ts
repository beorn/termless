import { describe, expect, it } from "vitest"
import { createApng } from "../../src/animation/apng.ts"
import type { AnimationFrame } from "../../src/animation/types.ts"

const frame1: AnimationFrame = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="#1e1e1e"/><text x="10" y="30" fill="#d4d4d4" font-family="monospace" font-size="14">Hello</text></svg>',
  duration: 500,
}

const frame2: AnimationFrame = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="#1e1e1e"/><text x="10" y="30" fill="#00ff00" font-family="monospace" font-size="14">World</text></svg>',
  duration: 500,
}

/** Search for a 4-byte ASCII chunk type in a buffer. */
function findChunk(buf: Uint8Array, chunkType: string): boolean {
  const target = [chunkType.charCodeAt(0), chunkType.charCodeAt(1), chunkType.charCodeAt(2), chunkType.charCodeAt(3)]
  for (let i = 0; i < buf.length - 3; i++) {
    if (buf[i] === target[0] && buf[i + 1] === target[1] && buf[i + 2] === target[2] && buf[i + 3] === target[3]) {
      return true
    }
  }
  return false
}

describe("createApng", () => {
  it("produces valid PNG with acTL chunk for 2 frames", async () => {
    const result = await createApng([frame1, frame2], { scale: 1 })

    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    expect(result[0]).toBe(0x89)
    expect(result[1]).toBe(0x50) // P
    expect(result[2]).toBe(0x4e) // N
    expect(result[3]).toBe(0x47) // G
    expect(result[4]).toBe(0x0d)
    expect(result[5]).toBe(0x0a)
    expect(result[6]).toBe(0x1a)
    expect(result[7]).toBe(0x0a)

    // Should have acTL chunk (APNG animation control)
    expect(findChunk(result, "acTL")).toBe(true)

    // Should have reasonable size
    expect(result.byteLength).toBeGreaterThan(100)
    expect(result.byteLength).toBeLessThan(200_000)
  })

  it("produces valid PNG for a single frame", async () => {
    const result = await createApng([frame1], { scale: 1 })

    // PNG signature
    expect(result[0]).toBe(0x89)
    expect(result[1]).toBe(0x50) // P
    expect(result[2]).toBe(0x4e) // N
    expect(result[3]).toBe(0x47) // G

    expect(result.byteLength).toBeGreaterThan(100)
  })

  it("throws on empty frames array", async () => {
    await expect(createApng([])).rejects.toThrow("at least one frame")
  })
})
