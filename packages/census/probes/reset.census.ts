import { census, feed } from "./_backends.ts"

census("reset", {}, (b, test) => {
  test("reset-sgr", { meta: { description: "SGR 0 clears all attributes" } }, ({ check }) => {
    feed(b, "\x1b[1;3;7mX\x1b[0mY")
    const cell = b.getCell(0, 1)
    check(cell.bold, "bold cleared").toBe(false)
    check(cell.italic, "italic cleared").toBe(false)
    check(!!cell.underline, "underline cleared").toBe(false)
  })

  test("reset-ris", { meta: { description: "RIS resets terminal state" } }, ({ check }) => {
    feed(b, "Hello World")
    feed(b, "\x1bc")
    check(b.getCursor().x, "cursor at col 0").toBe(0)
    check(b.getCursor().y, "cursor at row 0").toBe(0)
  })

  test("reset-method", { meta: { description: "reset() method clears state" } }, ({ check }) => {
    feed(b, "Hello World")
    b.reset()
    check(b.getCursor().x, "cursor at col 0").toBe(0)
    check(b.getCursor().y, "cursor at row 0").toBe(0)
  })
})
