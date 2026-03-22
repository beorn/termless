import { describe, test, beforeAll, afterAll, beforeEach } from "vitest"
import { backends, feed, support } from "./_backends.ts"
import type { TerminalBackend } from "./_backends.ts"

for (const [name, factory] of backends) {
  describe(name, () => {
    let b: TerminalBackend
    beforeAll(() => { b = factory(); b.init({ cols: 80, rows: 24 }) })
    afterAll(() => { b.destroy() })
    beforeEach(() => { b.reset() })

    describe("text", () => {
      test("basic rendering", { meta: { id: "text-basic" } }, () => {
        feed(b, "Hello")
        support(b.getText().includes("Hello"))
      })

      test("newline (CR+LF)", { meta: { id: "text-newline" } }, () => {
        feed(b, "A\r\nB")
        support(b.getCell(0, 0).char === "A" && b.getCell(1, 0).char === "B")
      })

      test("line wrap", { meta: { id: "text-wrap" } }, () => {
        feed(b, "X".repeat(85))
        support(b.getCell(1, 0).char === "X")
      })

      test("tab stop", { meta: { id: "text-tab" } }, () => {
        feed(b, "\tX")
        support(b.getCell(0, 8).char === "X")
      })

      test("wide emoji", { meta: { id: "text-wide-emoji" } }, () => {
        feed(b, "🎉")
        support(b.getCell(0, 0).wide)
      })

      test("CJK wide char", { meta: { id: "text-cjk" } }, () => {
        feed(b, "中")
        support(b.getCell(0, 0).wide)
      })

      test("overwrite with CUP", { meta: { id: "text-overwrite" } }, () => {
        feed(b, "AB\x1b[1GC")
        support(b.getCell(0, 0).char === "C")
      })

      test("carriage return", { meta: { id: "text-cr" } }, () => {
        feed(b, "AB\rC")
        support(b.getCell(0, 0).char === "C" && b.getCell(0, 1).char === "B")
      })
    })
  })
}
