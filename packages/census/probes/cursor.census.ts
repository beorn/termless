import { describe, test, beforeAll, afterAll, beforeEach } from "vitest"
import { backends, feed, support } from "./_backends.ts"
import type { TerminalBackend } from "./_backends.ts"

for (const [name, factory] of backends) {
  describe(name, () => {
    let b: TerminalBackend
    beforeAll(() => { b = factory(); b.init({ cols: 80, rows: 24 }) })
    afterAll(() => { b.destroy() })
    beforeEach(() => { b.reset() })

    describe("cursor", { meta: { spec: "ECMA-48 §8.3" } }, () => {
      test("CUP positioning", { meta: { id: "cursor-cup" } }, () => {
        feed(b, "\x1b[5;10H")
        const c = b.getCursor()
        support(c.x === 9 && c.y === 4)
      })

      test("home", { meta: { id: "cursor-home" } }, () => {
        feed(b, "ABC\x1b[H")
        const c = b.getCursor()
        support(c.x === 0 && c.y === 0)
      })

      test("forward", { meta: { id: "cursor-forward" } }, () => {
        feed(b, "\x1b[5C")
        support(b.getCursor().x === 5)
      })

      test("back", { meta: { id: "cursor-back" } }, () => {
        feed(b, "ABC\x1b[2D")
        support(b.getCursor().x === 1)
      })

      test("down", { meta: { id: "cursor-down" } }, () => {
        feed(b, "\x1b[3B")
        support(b.getCursor().y === 3)
      })

      test("up", { meta: { id: "cursor-up" } }, () => {
        feed(b, "\x1b[5B\x1b[2A")
        support(b.getCursor().y === 3)
      })

      test("hide", { meta: { id: "cursor-hide" } }, () => {
        feed(b, "\x1b[?25l")
        support(!b.getCursor().visible)
      })

      test("save/restore", { meta: { id: "cursor-save-restore" } }, () => {
        feed(b, "AB\x1b7\x1b[5;5H\x1b8")
        const c = b.getCursor()
        support(c.x === 2 && c.y === 0)
      })
    })
  })
}
