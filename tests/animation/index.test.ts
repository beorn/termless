import { describe, expect, it } from "vitest"
import { detectFormat, renderAnimation } from "../../src/animation/index.ts"
import type { AnimationFrame } from "../../src/animation/types.ts"

const frame1: AnimationFrame = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="#1e1e1e"/><text x="10" y="30" fill="#d4d4d4" font-family="monospace" font-size="14">Hello</text></svg>',
  duration: 500,
}

const frame2: AnimationFrame = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="#1e1e1e"/><text x="10" y="30" fill="#00ff00" font-family="monospace" font-size="14">World</text></svg>',
  duration: 500,
}

describe("detectFormat", () => {
  it("detects SVG format", () => {
    expect(detectFormat("animation.svg")).toBe("svg")
    expect(detectFormat("/path/to/file.svg")).toBe("svg")
  })

  it("detects GIF format", () => {
    expect(detectFormat("animation.gif")).toBe("gif")
    expect(detectFormat("/path/to/file.gif")).toBe("gif")
  })

  it("detects APNG format from .apng extension", () => {
    expect(detectFormat("animation.apng")).toBe("apng")
  })

  it("detects APNG format from .png extension", () => {
    expect(detectFormat("animation.png")).toBe("apng")
  })

  it("throws on unknown extension", () => {
    expect(() => detectFormat("file.mp4")).toThrow("Unknown animation format")
    expect(() => detectFormat("file.webm")).toThrow("Unknown animation format")
  })
})

describe("renderAnimation", () => {
  it("dispatches to animated SVG encoder", async () => {
    const result = await renderAnimation([frame1, frame2], "svg")
    expect(typeof result).toBe("string")
    expect(result as string).toContain("<svg")
    expect(result as string).toContain("@keyframes")
  })

  it("dispatches to GIF encoder", async () => {
    const result = await renderAnimation([frame1, frame2], "gif", { scale: 1 })
    expect(result).toBeInstanceOf(Uint8Array)
    const bytes = result as Uint8Array
    // GIF89a magic
    expect(bytes[0]).toBe(0x47)
    expect(bytes[1]).toBe(0x49)
    expect(bytes[2]).toBe(0x46)
  })

  it("dispatches to APNG encoder", async () => {
    const result = await renderAnimation([frame1, frame2], "apng", { scale: 1 })
    expect(result).toBeInstanceOf(Uint8Array)
    const bytes = result as Uint8Array
    // PNG magic
    expect(bytes[0]).toBe(0x89)
    expect(bytes[1]).toBe(0x50)
  })

  it("throws on unsupported format", async () => {
    await expect(renderAnimation([frame1], "cast" as any)).rejects.toThrow("Unsupported animation format")
  })
})
