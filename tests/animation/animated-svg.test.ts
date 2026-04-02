import { describe, expect, it } from "vitest"
import { createAnimatedSvg } from "../../src/animation/animated-svg.ts"
import type { AnimationFrame } from "../../src/animation/types.ts"

const frame1: AnimationFrame = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="#1e1e1e"/><text x="10" y="30" fill="#d4d4d4" font-family="monospace" font-size="14">Hello</text></svg>',
  duration: 500,
}

const frame2: AnimationFrame = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="#1e1e1e"/><text x="10" y="30" fill="#d4d4d4" font-family="monospace" font-size="14">World</text></svg>',
  duration: 500,
}

describe("createAnimatedSvg", () => {
  it("produces valid SVG with animation CSS for 2 frames", () => {
    const result = createAnimatedSvg([frame1, frame2])

    // Valid SVG structure
    expect(result).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
    expect(result).toContain("</svg>")
    expect(result).toContain('width="100"')
    expect(result).toContain('height="50"')

    // Has CSS animation
    expect(result).toContain("<style>")
    expect(result).toContain("@keyframes")
    expect(result).toContain("animation:")

    // Contains both frame contents
    expect(result).toContain("Hello")
    expect(result).toContain("World")

    // Frame groups
    expect(result).toContain('class="f0"')
    expect(result).toContain('class="f1"')
  })

  it("produces valid SVG for a single frame (no animation)", () => {
    const result = createAnimatedSvg([frame1])

    expect(result).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
    expect(result).toContain("</svg>")
    expect(result).toContain("Hello")

    // No animation CSS needed for single frame
    expect(result).not.toContain("<style>")
    expect(result).not.toContain("@keyframes")
  })

  it("uses correct visibility timing for frames", () => {
    const result = createAnimatedSvg([
      { ...frame1, duration: 1000 },
      { ...frame2, duration: 2000 },
    ])

    // Total duration should be 3 seconds
    expect(result).toContain("3s")

    // Should have keyframes for both frames
    expect(result).toContain("@keyframes f0")
    expect(result).toContain("@keyframes f1")
  })

  it("contains all frame content without outer SVG wrappers", () => {
    const result = createAnimatedSvg([frame1, frame2])

    // Should not contain nested <svg> elements
    const svgCount = (result.match(/<svg/g) || []).length
    expect(svgCount).toBe(1) // Only the outer wrapper

    // Inner content (rects, texts) should be present
    expect(result).toContain('<rect width="100" height="50" fill="#1e1e1e"/>')
    expect(result).toContain('font-family="monospace"')
  })

  it("respects loop option", () => {
    const result = createAnimatedSvg([frame1, frame2], { loop: 3 })
    // The iteration count "3" appears in the animation shorthand (not "infinite")
    expect(result).not.toContain("infinite")
    expect(result).toMatch(/animation:.*\b3\b/)
  })

  it("uses infinite loop by default", () => {
    const result = createAnimatedSvg([frame1, frame2])
    expect(result).toContain("infinite")
  })

  it("uses step-end timing for crisp transitions", () => {
    const result = createAnimatedSvg([frame1, frame2])
    expect(result).toContain("step-end")
  })

  it("throws on empty frames array", () => {
    expect(() => createAnimatedSvg([])).toThrow("at least one frame")
  })

  it("uses defaultDuration for frames without explicit duration", () => {
    const frameNoDuration: AnimationFrame = {
      svg: frame1.svg,
      duration: 0, // falsy, should use default
    }
    const result = createAnimatedSvg([frameNoDuration, frame2], { defaultDuration: 200 })
    // Total: 200 + 500 = 700ms = 0.7s
    expect(result).toContain("0.7s")
  })
})
