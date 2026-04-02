import { describe, it, expect } from "vitest"
import { hasFrameChanged, generateHtmlSlideshow, type RecordedFrame } from "../src/record.ts"
import { isTerminalResponse, bytesToTapeCommand, eventsToTape, SKIP } from "../src/record-cmd.ts"

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

    expect(html).toContain("Hello &amp; World")
  })
})

// ── Terminal response detection ──

describe("isTerminalResponse", () => {
  function encode(str: string): Uint8Array {
    return new TextEncoder().encode(str)
  }

  it("detects Kitty keyboard protocol responses", () => {
    // \x1b[?0u — disable Kitty keyboard
    expect(isTerminalResponse(encode("\x1b[?0u"), "\x1b[?0u")).toBe(true)
    // \x1b[106u — Kitty key event
    expect(isTerminalResponse(encode("\x1b[106u"), "\x1b[106u")).toBe(true)
    // \x1b[106;1:3u — Kitty key event with modifiers
    expect(isTerminalResponse(encode("\x1b[106;1:3u"), "\x1b[106;1:3u")).toBe(true)
  })

  it("detects focus events", () => {
    expect(isTerminalResponse(encode("\x1b[I"), "\x1b[I")).toBe(true)
    expect(isTerminalResponse(encode("\x1b[O"), "\x1b[O")).toBe(true)
  })

  it("detects device attribute responses", () => {
    // DA1 response
    expect(isTerminalResponse(encode("\x1b[?62;4c"), "\x1b[?62;4c")).toBe(true)
    // DA2 response
    expect(isTerminalResponse(encode("\x1b[>1;95;0c"), "\x1b[>1;95;0c")).toBe(true)
  })

  it("detects mouse report sequences", () => {
    // SGR mouse press
    expect(isTerminalResponse(encode("\x1b[<0;10;5M"), "\x1b[<0;10;5M")).toBe(true)
    // SGR mouse release
    expect(isTerminalResponse(encode("\x1b[<0;10;5m"), "\x1b[<0;10;5m")).toBe(true)
  })

  it("detects OSC responses", () => {
    // OSC 4 palette query
    expect(isTerminalResponse(encode("\x1b]4;0;rgb:0000/0000/0000\x07"), "\x1b]4;0;rgb:0000/0000/0000\x07")).toBe(true)
    // OSC 11 background color
    expect(isTerminalResponse(encode("\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\"), "\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\")).toBe(
      true,
    )
  })

  it("detects DSR cursor position report", () => {
    expect(isTerminalResponse(encode("\x1b[24;1R"), "\x1b[24;1R")).toBe(true)
  })

  it("detects DECRPM mode report", () => {
    expect(isTerminalResponse(encode("\x1b[?2004;2$y"), "\x1b[?2004;2$y")).toBe(true)
  })

  it("does NOT detect normal arrow keys as terminal responses", () => {
    expect(isTerminalResponse(encode("\x1b[A"), "\x1b[A")).toBe(false)
    expect(isTerminalResponse(encode("\x1b[B"), "\x1b[B")).toBe(false)
    expect(isTerminalResponse(encode("\x1b[C"), "\x1b[C")).toBe(false)
    expect(isTerminalResponse(encode("\x1b[D"), "\x1b[D")).toBe(false)
  })

  it("does NOT detect single printable characters", () => {
    expect(isTerminalResponse(encode("a"), "a")).toBe(false)
    expect(isTerminalResponse(encode(" "), " ")).toBe(false)
  })

  it("does NOT detect Alt+key", () => {
    expect(isTerminalResponse(encode("\x1bj"), "\x1bj")).toBe(false)
  })
})

// ── bytesToTapeCommand with filtering ──

describe("bytesToTapeCommand", () => {
  function encode(str: string): Uint8Array {
    return new TextEncoder().encode(str)
  }

  it("maps Enter correctly", () => {
    expect(bytesToTapeCommand(new Uint8Array([0x0d]))).toBe("Enter")
  })

  it("maps Tab correctly", () => {
    expect(bytesToTapeCommand(new Uint8Array([0x09]))).toBe("Tab")
  })

  it("maps Escape correctly", () => {
    expect(bytesToTapeCommand(new Uint8Array([0x1b]))).toBe("Escape")
  })

  it("maps Backspace correctly", () => {
    expect(bytesToTapeCommand(new Uint8Array([0x7f]))).toBe("Backspace")
  })

  it("maps Space correctly", () => {
    expect(bytesToTapeCommand(new Uint8Array([0x20]))).toBe("Space")
  })

  it("maps Ctrl+key correctly", () => {
    // Ctrl+C = 0x03
    expect(bytesToTapeCommand(new Uint8Array([0x03]))).toBe("Ctrl+c")
    // Ctrl+A = 0x01
    expect(bytesToTapeCommand(new Uint8Array([0x01]))).toBe("Ctrl+a")
  })

  it("returns null for printable characters", () => {
    expect(bytesToTapeCommand(encode("a"))).toBeNull()
    expect(bytesToTapeCommand(encode("Z"))).toBeNull()
    expect(bytesToTapeCommand(encode("5"))).toBeNull()
  })

  it("maps arrow keys correctly", () => {
    expect(bytesToTapeCommand(encode("\x1b[A"))).toBe("Up")
    expect(bytesToTapeCommand(encode("\x1b[B"))).toBe("Down")
    expect(bytesToTapeCommand(encode("\x1b[C"))).toBe("Right")
    expect(bytesToTapeCommand(encode("\x1b[D"))).toBe("Left")
  })

  it("maps special keys correctly", () => {
    expect(bytesToTapeCommand(encode("\x1b[H"))).toBe("Home")
    expect(bytesToTapeCommand(encode("\x1b[F"))).toBe("End")
    expect(bytesToTapeCommand(encode("\x1b[3~"))).toBe("Delete")
    expect(bytesToTapeCommand(encode("\x1b[5~"))).toBe("PageUp")
    expect(bytesToTapeCommand(encode("\x1b[6~"))).toBe("PageDown")
  })

  it("maps Alt+key correctly", () => {
    expect(bytesToTapeCommand(encode("\x1bj"))).toBe("Alt+j")
    expect(bytesToTapeCommand(encode("\x1bk"))).toBe("Alt+k")
  })

  it("returns SKIP for terminal responses by default", () => {
    expect(bytesToTapeCommand(encode("\x1b[?0u"))).toBe(SKIP)
    expect(bytesToTapeCommand(encode("\x1b[I"))).toBe(SKIP)
    expect(bytesToTapeCommand(encode("\x1b[?62;4c"))).toBe(SKIP)
    expect(bytesToTapeCommand(encode("\x1b[<0;10;5M"))).toBe(SKIP)
  })

  it("preserves terminal responses in raw mode", () => {
    // In raw mode, these should fall through to null (unknown sequences)
    expect(bytesToTapeCommand(encode("\x1b[?0u"), true)).toBeNull()
    expect(bytesToTapeCommand(encode("\x1b[I"), true)).toBeNull()
    expect(bytesToTapeCommand(encode("\x1b[?62;4c"), true)).toBeNull()
  })
})

// ── eventsToTape with filtering ──

describe("eventsToTape", () => {
  function encode(str: string): Uint8Array {
    return new TextEncoder().encode(str)
  }

  function makeEvent(time: number, str: string): { time: number; bytes: Uint8Array } {
    return { time, bytes: encode(str) }
  }

  it("produces basic tape output", () => {
    const events = [makeEvent(0, "h"), makeEvent(10, "i")]
    const tape = eventsToTape(events, "bash")
    expect(tape).toContain('Set Shell "bash"')
    expect(tape).toContain('Type "hi"')
  })

  it("filters out terminal responses", () => {
    const events = [
      makeEvent(0, "h"),
      makeEvent(10, "\x1b[?0u"), // Kitty keyboard response — should be stripped
      makeEvent(20, "i"),
    ]
    const tape = eventsToTape(events, "bash")
    expect(tape).toContain('Type "hi"')
    // The garbled text like 'Type "ype "' should not appear
    expect(tape).not.toContain("SKIP")
    expect(tape).not.toContain("?0u")
    // Should not have split the "hi" into separate Type commands
    expect(tape.match(/Type /g)?.length).toBe(1)
  })

  it("filters out focus events", () => {
    const events = [
      makeEvent(0, "a"),
      makeEvent(10, "\x1b[I"), // Focus in
      makeEvent(20, "b"),
    ]
    const tape = eventsToTape(events, "bash")
    expect(tape).toContain('Type "ab"')
  })

  it("preserves terminal responses in raw mode", () => {
    const events = [makeEvent(0, "h"), makeEvent(10, "\x1b[?0u")]
    const tape = eventsToTape(events, "bash", true)
    // In raw mode, the kitty response gets treated as an unknown sequence (null)
    // and accumulated as a Type command
    expect(tape).not.toContain("SKIP")
  })

  it("handles Sleep gaps", () => {
    const events = [
      makeEvent(0, "a"),
      makeEvent(1500, "b"), // 1.5s gap
    ]
    const tape = eventsToTape(events, "bash")
    expect(tape).toContain('Type "a"')
    expect(tape).toContain("Sleep 1.5s")
    expect(tape).toContain('Type "b"')
  })

  it("handles Enter correctly", () => {
    const events = [
      makeEvent(0, "h"),
      makeEvent(10, "i"),
      { time: 20, bytes: new Uint8Array([0x0d]) }, // Enter
    ]
    const tape = eventsToTape(events, "bash")
    expect(tape).toContain('Type "hi"')
    expect(tape).toContain("Enter")
  })

  it("filters multiple consecutive terminal responses", () => {
    const events = [
      makeEvent(0, "\x1b[?0u"), // Kitty
      makeEvent(5, "\x1b[I"), // Focus in
      makeEvent(10, "\x1b[?62;4c"), // DA1 response
      makeEvent(15, "h"),
      makeEvent(20, "i"),
    ]
    const tape = eventsToTape(events, "bash")
    expect(tape).toContain('Type "hi"')
    // None of the responses should appear
    expect(tape).not.toContain("?0u")
    expect(tape).not.toContain("[I")
    expect(tape).not.toContain("62;4c")
  })
})
