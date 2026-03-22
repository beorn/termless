import { describe, test, beforeAll, afterAll, beforeEach } from "vitest"
import { backends, feed, support } from "./_backends.ts"
import type { TerminalBackend } from "./_backends.ts"

for (const [name, factory] of backends) {
  describe(name, () => {
    let b: TerminalBackend
    beforeAll(() => { b = factory(); b.init({ cols: 80, rows: 24 }) })
    afterAll(() => { b.destroy() })
    beforeEach(() => { b.reset() })

    describe("erase", { meta: { spec: "ECMA-48 §8.3.39 (EL), §8.3.40 (ED)" } }, () => {
      test("erase line right (EL 0)", { meta: { id: "erase-line-right" } }, () => {
        feed(b, "XXXXX\x1b[1G\x1b[K")
        support(b.getCell(0, 0).char === "" || b.getCell(0, 0).char === " ")
      })

      test("erase line left (EL 1)", { meta: { id: "erase-line-left" } }, () => {
        feed(b, "XXXXX\x1b[3G\x1b[1K")
        const c0 = b.getCell(0, 0).char
        const c1 = b.getCell(0, 1).char
        const c2 = b.getCell(0, 2).char
        support((c0 === "" || c0 === " ") && (c1 === "" || c1 === " ") && (c2 === "" || c2 === " "))
      })

      test("erase line all (EL 2)", { meta: { id: "erase-line-all" } }, () => {
        feed(b, "XXXXX\x1b[2K")
        support(b.getCell(0, 0).char === "" || b.getCell(0, 0).char === " ")
      })

      test("erase screen below (ED 0)", { meta: { id: "erase-screen-below" } }, () => {
        feed(b, "AAA\r\nBBB\r\nCCC\x1b[H\x1b[J")
        support(!b.getText().includes("BBB"))
      })

      test("erase screen all (ED 2)", { meta: { id: "erase-screen-all" } }, () => {
        feed(b, "AAA\r\nBBB\r\nCCC\x1b[2J")
        const text = b.getText().trim()
        support(text === "")
      })
    })
  })
}
