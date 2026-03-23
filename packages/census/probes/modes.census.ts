import { test } from "vitest"
import { census, feed, expect } from "./_backends.ts"

census("modes", { spec: "DEC private modes" }, (b) => {
  test("mode-alt-screen", { meta: { description: "Alt screen enter" } }, () => {
    feed(b, "\x1b[?1049h")
    expect(b.getMode("altScreen")).toBe(true)
  })

  test("mode-alt-screen-exit", { meta: { description: "Alt screen exit" } }, () => {
    feed(b, "\x1b[?1049h\x1b[?1049l")
    expect(b.getMode("altScreen")).toBe(false)
  })

  test("mode-bracketed-paste", { meta: { description: "Bracketed paste mode" } }, () => {
    feed(b, "\x1b[?2004h")
    expect(b.getMode("bracketedPaste")).toBe(true)
  })

  test("mode-application-cursor", { meta: { description: "Application cursor keys" } }, () => {
    feed(b, "\x1b[?1h")
    expect(b.getMode("applicationCursor")).toBe(true)
  })

  test("mode-auto-wrap", { meta: { description: "Auto-wrap at right margin" } }, () => {
    feed(b, "X".repeat(80) + "Y")
    expect(b.getCell(1, 0).char).toBe("Y")
  })

  test("mode-mouse-tracking", { meta: { description: "Mouse tracking (X10)" } }, () => {
    feed(b, "\x1b[?1000h")
    expect(b.getMode("mouseTracking")).toBe(true)
  })

  test("mode-focus-tracking", { meta: { description: "Focus in/out events" } }, () => {
    feed(b, "\x1b[?1004h")
    expect(b.getMode("focusTracking")).toBe(true)
  })

  test("mode-reverse-video", { meta: { description: "Reverse video (DECSCNM)" } }, () => {
    feed(b, "\x1b[?5h")
    expect(b.getMode("reverseVideo")).toBe(true)
  })
})
