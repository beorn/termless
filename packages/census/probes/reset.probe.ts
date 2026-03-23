import { describeBackends, feed, test, expect } from "./_backends.ts"

describeBackends("reset", (b) => {
  test("reset.sgr", () => {
    feed(b, "\x1b[1;3;7mX\x1b[0mY")
    const cell = b.getCell(0, 1)
    expect(cell.bold).toBe(false)
    expect(cell.italic).toBe(false)
    expect(!!cell.underline).toBe(false)
  })

  test("reset.ris", () => {
    feed(b, "Hello World")
    feed(b, "\x1bc")
    expect(b.getCursor().x).toBe(0)
    expect(b.getCursor().y).toBe(0)
  })

  test("reset.method", () => {
    feed(b, "Hello World")
    b.reset()
    expect(b.getCursor().x).toBe(0)
    expect(b.getCursor().y).toBe(0)
  })
})
