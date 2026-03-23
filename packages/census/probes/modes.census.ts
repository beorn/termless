import { census, feed } from "./_backends.ts"

census("modes", { spec: "DEC private modes" }, (b, test) => {
  test("mode-alt-screen", { meta: { description: "Alt screen enter" } }, ({ check }) => {
    feed(b, "\x1b[?1049h")
    check(b.getMode("altScreen"), "altScreen on").toBe(true)
  })

  test("mode-alt-screen-exit", { meta: { description: "Alt screen exit" } }, ({ check }) => {
    feed(b, "\x1b[?1049h\x1b[?1049l")
    check(b.getMode("altScreen"), "altScreen off").toBe(false)
  })

  test("mode-bracketed-paste", { meta: { description: "Bracketed paste mode" } }, ({ check }) => {
    feed(b, "\x1b[?2004h")
    check(b.getMode("bracketedPaste"), "bracketedPaste on").toBe(true)
  })

  test("mode-application-cursor", { meta: { description: "Application cursor keys" } }, ({ check }) => {
    feed(b, "\x1b[?1h")
    check(b.getMode("applicationCursor"), "applicationCursor on").toBe(true)
  })

  test("mode-auto-wrap", { meta: { description: "Auto-wrap at right margin" } }, ({ check }) => {
    feed(b, "X".repeat(80) + "Y")
    check(b.getCell(1, 0).char, "wrapped to next line").toBe("Y")
  })

  test("mode-mouse-tracking", { meta: { description: "Mouse tracking (X10)" } }, ({ check }) => {
    feed(b, "\x1b[?1000h")
    check(b.getMode("mouseTracking"), "mouseTracking on").toBe(true)
  })

  test("mode-focus-tracking", { meta: { description: "Focus in/out events" } }, ({ check }) => {
    feed(b, "\x1b[?1004h")
    check(b.getMode("focusTracking"), "focusTracking on").toBe(true)
  })

  test("mode-reverse-video", { meta: { description: "Reverse video (DECSCNM)" } }, ({ check }) => {
    feed(b, "\x1b[?5h")
    check(b.getMode("reverseVideo"), "reverseVideo on").toBe(true)
  })
})
