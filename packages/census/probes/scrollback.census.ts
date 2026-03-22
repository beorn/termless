import { describe, test, beforeAll, afterAll, beforeEach } from "vitest"
import { backends, feed, support } from "./_backends.ts"
import type { TerminalBackend } from "./_backends.ts"

for (const [name, factory] of backends) {
  describe(name, () => {
    let b: TerminalBackend
    beforeAll(() => { b = factory(); b.init({ cols: 80, rows: 24 }) })
    afterAll(() => { b.destroy() })
    beforeEach(() => { b.reset() })

    describe("scrollback", () => {
      test("accumulates on overflow", { meta: { id: "scrollback-accumulate" } }, () => {
        for (let i = 0; i < 30; i++) feed(b, `line ${i}\r\n`)
        support(b.getScrollback().totalLines > 24)
      })

      test("total lines count", { meta: { id: "scrollback-total-lines" } }, () => {
        for (let i = 0; i < 30; i++) feed(b, `line ${i}\r\n`)
        support(b.getScrollback().totalLines >= 30)
      })

      test("scroll up (SU)", { meta: { id: "scrollback-scroll-up" } }, () => {
        feed(b, "TOP\r\n")
        for (let i = 0; i < 23; i++) feed(b, `line ${i}\r\n`)
        const before = b.getCell(0, 0).char
        feed(b, "\x1b[S")
        const after = b.getCell(0, 0).char
        support(before !== after || after !== "T")
      })

      test("reverse index at top", { meta: { id: "scrollback-reverse-index" } }, () => {
        feed(b, "A\r\nB\r\nC")
        feed(b, "\x1b[H\x1bM")
        // After reverse index at top, row 0 should be empty, A pushed to row 1
        const row0 = b.getCell(0, 0).char
        support(row0 === "" || row0 === " ")
      })

      test("alt screen separates scrollback", { meta: { id: "scrollback-alt-screen" } }, () => {
        feed(b, "NORMAL")
        feed(b, "\x1b[?1049h")
        support(b.getMode("altScreen"))
      })
    })
  })
}
