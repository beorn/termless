import { test } from "vitest"
import { census, feed, expect } from "./_backends.ts"

census("reset", {}, (b) => {
  test("reset-sgr", { meta: { description: "SGR 0 clears all attributes" } }, () => {
    feed(b, "\x1b[1;3;7mX\x1b[0mY")
    const cell = b.getCell(0, 1)
    expect(cell.bold).toBe(false)
    expect(cell.italic).toBe(false)
    expect(!!cell.underline).toBe(false)
  })

  test("reset-ris", { meta: { description: "RIS resets terminal state" } }, () => {
    feed(b, "Hello World")
    feed(b, "\x1bc")
    expect(b.getCursor().x).toBe(0)
    expect(b.getCursor().y).toBe(0)
  })

  test("reset-method", { meta: { description: "reset() method clears state" } }, () => {
    feed(b, "Hello World")
    b.reset()
    expect(b.getCursor().x).toBe(0)
    expect(b.getCursor().y).toBe(0)
  })
})
