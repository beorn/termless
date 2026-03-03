import { describe, it, expect } from "vitest"
import { hasFrameChanged, generateHtmlSlideshow, type RecordedFrame } from "../src/record.ts"

// ── Frame change detection ──

describe("hasFrameChanged", () => {
  it("returns true when previousText is null (first frame)", () => {
    expect(hasFrameChanged("hello", null)).toBe(true)
  })

  it("returns true when previousText is null and currentText is empty", () => {
    expect(hasFrameChanged("", null)).toBe(true)
  })

  it("returns true when content has changed", () => {
    expect(hasFrameChanged("hello world", "hello")).toBe(true)
  })

  it("returns false when content is identical", () => {
    expect(hasFrameChanged("same content", "same content")).toBe(false)
  })

  it("returns false for empty strings that match", () => {
    expect(hasFrameChanged("", "")).toBe(false)
  })

  it("detects whitespace-only changes", () => {
    expect(hasFrameChanged("hello ", "hello")).toBe(true)
  })

  it("detects changes in multiline content", () => {
    const prev = "line1\nline2\nline3"
    const curr = "line1\nline2\nline3\nline4"
    expect(hasFrameChanged(curr, prev)).toBe(true)
  })

  it("returns false for identical multiline content", () => {
    const text = "line1\nline2\nline3"
    expect(hasFrameChanged(text, text)).toBe(false)
  })
})

// ── HTML slideshow generation ──

describe("generateHtmlSlideshow", () => {
  function makeFrames(count: number): RecordedFrame[] {
    return Array.from({ length: count }, (_, i) => ({
      index: i,
      timestamp: i * 100,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><text>Frame ${i}</text></svg>`,
    }))
  }

  it("generates valid HTML for empty frames", () => {
    const html = generateHtmlSlideshow([], 100)
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain("No frames recorded.")
  })

  it("generates valid HTML structure", () => {
    const frames = makeFrames(3)
    const html = generateHtmlSlideshow(frames, 100)

    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain("<html")
    expect(html).toContain("</html>")
    expect(html).toContain("<script>")
    expect(html).toContain("</script>")
  })

  it("embeds all SVG frames inline", () => {
    const frames = makeFrames(3)
    const html = generateHtmlSlideshow(frames, 100)

    expect(html).toContain("Frame 0")
    expect(html).toContain("Frame 1")
    expect(html).toContain("Frame 2")
  })

  it("creates frame divs with correct IDs", () => {
    const frames = makeFrames(3)
    const html = generateHtmlSlideshow(frames, 100)

    expect(html).toContain('id="frame-0"')
    expect(html).toContain('id="frame-1"')
    expect(html).toContain('id="frame-2"')
  })

  it("shows only the first frame by default", () => {
    const frames = makeFrames(3)
    const html = generateHtmlSlideshow(frames, 100)

    // First frame visible
    expect(html).toContain('id="frame-0" style="display:block"')
    // Others hidden
    expect(html).toContain('id="frame-1" style="display:none"')
    expect(html).toContain('id="frame-2" style="display:none"')
  })

  it("includes frame count in info", () => {
    const frames = makeFrames(5)
    const html = generateHtmlSlideshow(frames, 100)

    expect(html).toContain("Frame 1 / 5")
  })

  it("includes play/pause button", () => {
    const frames = makeFrames(2)
    const html = generateHtmlSlideshow(frames, 100)

    expect(html).toContain('id="play-btn"')
    expect(html).toContain("Pause")
  })

  it("includes navigation buttons", () => {
    const frames = makeFrames(2)
    const html = generateHtmlSlideshow(frames, 100)

    expect(html).toContain('id="prev-btn"')
    expect(html).toContain('id="next-btn"')
  })

  it("includes keyboard shortcut hints", () => {
    const frames = makeFrames(2)
    const html = generateHtmlSlideshow(frames, 100)

    expect(html).toContain("Space")
  })

  it("uses the provided interval for playback", () => {
    const frames = makeFrames(2)
    const html = generateHtmlSlideshow(frames, 250)

    // The interval should appear in the script
    expect(html).toContain("const interval = 250")
  })

  it("embeds timestamps array in script", () => {
    const frames = makeFrames(3)
    const html = generateHtmlSlideshow(frames, 100)

    expect(html).toContain("const timestamps = [0,100,200]")
  })

  it("includes total frame count in script", () => {
    const frames = makeFrames(4)
    const html = generateHtmlSlideshow(frames, 100)

    expect(html).toContain("const totalFrames = 4")
  })

  it("handles single frame", () => {
    const frames = makeFrames(1)
    const html = generateHtmlSlideshow(frames, 100)

    expect(html).toContain("Frame 1 / 1")
    expect(html).toContain('id="frame-0" style="display:block"')
    expect(html).not.toContain('id="frame-1"')
  })

  it("preserves SVG content including special characters", () => {
    const frames: RecordedFrame[] = [
      {
        index: 0,
        timestamp: 0,
        svg: '<svg><text fill="#d4d4d4">Hello &amp; World</text></svg>',
      },
    ]
    const html = generateHtmlSlideshow(frames, 100)

    expect(html).toContain('Hello &amp; World')
  })
})
