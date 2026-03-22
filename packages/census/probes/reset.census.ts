import { describe, test, beforeAll, afterAll, beforeEach } from "vitest"
import { backends, feed, support } from "./_backends.ts"
import type { TerminalBackend } from "./_backends.ts"

for (const [name, factory] of backends) {
  describe(name, () => {
    let b: TerminalBackend
    beforeAll(() => { b = factory(); b.init({ cols: 80, rows: 24 }) })
    afterAll(() => { b.destroy() })
    beforeEach(() => { b.reset() })

    describe("reset", () => {
      test("SGR reset clears attributes", { meta: { id: "reset-sgr" } }, () => {
        feed(b, "\x1b[1;3;7mX\x1b[0mY")
        const cell = b.getCell(0, 1)
        support(!cell.bold && !cell.italic && !cell.inverse)
      })

      test("RIS clears screen", { meta: { id: "reset-ris" } }, () => {
        feed(b, "Hello World")
        feed(b, "\x1bc")
        const c = b.getCursor()
        support(c.x === 0 && c.y === 0)
      })

      test("reset() method", { meta: { id: "reset-method" } }, () => {
        feed(b, "Hello World")
        b.reset()
        const c = b.getCursor()
        support(c.x === 0 && c.y === 0)
      })
    })
  })
}
