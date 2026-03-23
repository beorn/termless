import { describeBackends, feed, test, expect } from "./setup.ts"

describeBackends("modes", (b) => {
  test("modes.alt-screen.enter", () => {
    feed(b, "\x1b[?1049h")
    expect(b.getMode("altScreen")).toBe(true)
  })

  test("modes.alt-screen.exit", () => {
    feed(b, "\x1b[?1049h\x1b[?1049l")
    expect(b.getMode("altScreen")).toBe(false)
  })

  test("modes.bracketed-paste", () => {
    feed(b, "\x1b[?2004h")
    expect(b.getMode("bracketedPaste")).toBe(true)
  })

  test("modes.application-cursor", () => {
    feed(b, "\x1b[?1h")
    expect(b.getMode("applicationCursor")).toBe(true)
  })

  test("modes.auto-wrap", () => {
    feed(b, "X".repeat(80) + "Y")
    expect(b.getCell(1, 0).char).toBe("Y")
  })

  test("modes.mouse-tracking", () => {
    feed(b, "\x1b[?1000h")
    expect(b.getMode("mouseTracking")).toBe(true)
  })

  test("modes.focus-tracking", () => {
    feed(b, "\x1b[?1004h")
    expect(b.getMode("focusTracking")).toBe(true)
  })

  test("modes.reverse-video", () => {
    feed(b, "\x1b[?5h")
    expect(b.getMode("reverseVideo")).toBe(true)
  })
})
