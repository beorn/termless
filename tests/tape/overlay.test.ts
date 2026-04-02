/**
 * Tests for the keystroke overlay function.
 *
 * Verifies that overlayKeystroke produces valid SVG with correctly positioned
 * badges for various keystroke strings and position options.
 */

import { describe, test, expect } from "vitest"
import { overlayKeystroke } from "../../src/tape/overlay.ts"

// =============================================================================
// Helpers
// =============================================================================

/** Minimal valid SVG for testing. */
const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="672" height="432">
<rect width="100%" height="100%" fill="#1e1e1e"/>
<text x="0" y="14" font-family="monospace" fill="#d4d4d4">hello</text>
</svg>`

// =============================================================================
// Basic functionality
// =============================================================================

describe("overlayKeystroke", () => {
  test("produces valid SVG with badge", () => {
    const result = overlayKeystroke(SAMPLE_SVG, "Enter")
    expect(result).toContain("<svg")
    expect(result).toContain("</svg>")
    expect(result).toContain("key-overlay")
    expect(result).toContain("Enter")
  })

  test("returns original SVG when keystroke is empty", () => {
    const result = overlayKeystroke(SAMPLE_SVG, "")
    expect(result).toBe(SAMPLE_SVG)
  })

  test("badge contains rounded rect and text", () => {
    const result = overlayKeystroke(SAMPLE_SVG, "Ctrl+C")
    expect(result).toContain("<rect")
    expect(result).toContain("rx=")
    expect(result).toContain("ry=")
    expect(result).toContain("<text")
    expect(result).toContain("Ctrl+C")
  })

  test("badge is inserted before closing svg tag", () => {
    const result = overlayKeystroke(SAMPLE_SVG, "j")
    const closingIndex = result.lastIndexOf("</svg>")
    const overlayIndex = result.lastIndexOf("key-overlay")
    expect(overlayIndex).toBeLessThan(closingIndex)
    expect(overlayIndex).toBeGreaterThan(0)
  })
})

// =============================================================================
// Position options
// =============================================================================

describe("position options", () => {
  test("bottom-right (default)", () => {
    const result = overlayKeystroke(SAMPLE_SVG, "x")
    // Badge should be near the right edge
    const rectMatch = result.match(/<g class="key-overlay">\n<rect x="(\d+(?:\.\d+)?)"/)
    expect(rectMatch).not.toBeNull()
    const x = Number.parseFloat(rectMatch![1]!)
    // With width=672 and margin=10, x should be near the right side
    expect(x).toBeGreaterThan(600)
  })

  test("bottom-left", () => {
    const result = overlayKeystroke(SAMPLE_SVG, "x", { position: "bottom-left" })
    const rectMatch = result.match(/<g class="key-overlay">\n<rect x="(\d+(?:\.\d+)?)"/)
    expect(rectMatch).not.toBeNull()
    const x = Number.parseFloat(rectMatch![1]!)
    // x should be at the left margin
    expect(x).toBe(10)
  })

  test("top-right", () => {
    const result = overlayKeystroke(SAMPLE_SVG, "x", { position: "top-right" })
    const rectMatch = result.match(/<g class="key-overlay">\n<rect x="(\d+(?:\.\d+)?)" y="(\d+(?:\.\d+)?)"/)
    expect(rectMatch).not.toBeNull()
    const y = Number.parseFloat(rectMatch![2]!)
    // y should be at the top margin
    expect(y).toBe(10)
  })

  test("top-left", () => {
    const result = overlayKeystroke(SAMPLE_SVG, "x", { position: "top-left" })
    const rectMatch = result.match(/<g class="key-overlay">\n<rect x="(\d+(?:\.\d+)?)" y="(\d+(?:\.\d+)?)"/)
    expect(rectMatch).not.toBeNull()
    const x = Number.parseFloat(rectMatch![1]!)
    const y = Number.parseFloat(rectMatch![2]!)
    expect(x).toBe(10)
    expect(y).toBe(10)
  })
})

// =============================================================================
// Various keystroke strings
// =============================================================================

describe("keystroke strings", () => {
  test("single character", () => {
    const result = overlayKeystroke(SAMPLE_SVG, "j")
    expect(result).toContain(">j</text>")
  })

  test("modifier combo", () => {
    const result = overlayKeystroke(SAMPLE_SVG, "Ctrl+Shift+P")
    expect(result).toContain("Ctrl+Shift+P")
  })

  test("long text is preserved", () => {
    const result = overlayKeystroke(SAMPLE_SVG, "Type: hello world this is long")
    expect(result).toContain("Type: hello world this is long")
  })

  test("special characters are XML-escaped", () => {
    const result = overlayKeystroke(SAMPLE_SVG, '<script>"test"</script>')
    expect(result).toContain("&lt;script&gt;")
    expect(result).toContain("&quot;test&quot;")
    expect(result).not.toContain("<script>")
  })

  test("badge width scales with text length", () => {
    const short = overlayKeystroke(SAMPLE_SVG, "j")
    const long = overlayKeystroke(SAMPLE_SVG, "Ctrl+Shift+Alt+P")

    // Extract badge widths
    const shortWidth = short.match(/class="key-overlay">\n<rect[^>]+width="(\d+(?:\.\d+)?)"/)
    const longWidth = long.match(/class="key-overlay">\n<rect[^>]+width="(\d+(?:\.\d+)?)"/)
    expect(shortWidth).not.toBeNull()
    expect(longWidth).not.toBeNull()

    const sw = Number.parseFloat(shortWidth![1]!)
    const lw = Number.parseFloat(longWidth![1]!)
    expect(lw).toBeGreaterThan(sw)
  })
})
