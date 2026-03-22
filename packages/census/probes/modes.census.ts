import { describe, test, beforeAll, afterAll, beforeEach } from "vitest"
import { backends, feed, support } from "./_backends.ts"
import type { TerminalBackend } from "./_backends.ts"

for (const [name, factory] of backends) {
  describe(name, () => {
    let b: TerminalBackend
    beforeAll(() => { b = factory(); b.init({ cols: 80, rows: 24 }) })
    afterAll(() => { b.destroy() })
    beforeEach(() => { b.reset() })

    describe("modes", { meta: { spec: "ECMA-48 / DEC private modes" } }, () => {
      test("alt screen enter", { meta: { id: "mode-alt-screen" } }, () => {
        feed(b, "\x1b[?1049h")
        support(b.getMode("altScreen"))
      })

      test("alt screen exit", { meta: { id: "mode-alt-screen-exit" } }, () => {
        feed(b, "\x1b[?1049h\x1b[?1049l")
        support(!b.getMode("altScreen"))
      })

      test("bracketed paste", { meta: { id: "mode-bracketed-paste" } }, () => {
        feed(b, "\x1b[?2004h")
        support(b.getMode("bracketedPaste"))
      })

      test("application cursor", { meta: { id: "mode-application-cursor" } }, () => {
        feed(b, "\x1b[?1h")
        support(b.getMode("applicationCursor"))
      })

      test("auto-wrap", { meta: { id: "mode-auto-wrap" } }, () => {
        feed(b, "X".repeat(80) + "Y")
        support(b.getCell(1, 0).char === "Y")
      })

      test("mouse tracking", { meta: { id: "mode-mouse-tracking" } }, () => {
        feed(b, "\x1b[?1000h")
        support(b.getMode("mouseTracking"))
      })

      test("focus tracking", { meta: { id: "mode-focus-tracking" } }, () => {
        feed(b, "\x1b[?1004h")
        support(b.getMode("focusTracking"))
      })

      test("reverse video", { meta: { id: "mode-reverse-video" } }, () => {
        feed(b, "\x1b[?5h")
        support(b.getMode("reverseVideo"))
      })
    })
  })
}
