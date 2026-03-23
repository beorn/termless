import { describeBackends, feed, test, expect } from "./setup.ts"

describeBackends("cursor", (b) => {
  test("cursor.move.absolute", () => {
    feed(b, "\x1b[5;10H")
    expect(b.getCursor().x).toBe(9)
    expect(b.getCursor().y).toBe(4)
  })

  test("cursor.move.home", () => {
    feed(b, "ABC\x1b[H")
    expect(b.getCursor().x).toBe(0)
    expect(b.getCursor().y).toBe(0)
  })

  test("cursor.move.forward", () => {
    feed(b, "\x1b[5C")
    expect(b.getCursor().x).toBe(5)
  })

  test("cursor.move.back", () => {
    feed(b, "ABC\x1b[2D")
    expect(b.getCursor().x).toBe(1)
  })

  test("cursor.move.down", () => {
    feed(b, "\x1b[3B")
    expect(b.getCursor().y).toBe(3)
  })

  test("cursor.move.up", () => {
    feed(b, "\x1b[5B\x1b[2A")
    expect(b.getCursor().y).toBe(3)
  })

  test("cursor.hide", () => {
    feed(b, "\x1b[?25l")
    expect(b.getCursor().visible).toBe(false)
  })

  test("cursor.save-restore", () => {
    feed(b, "AB\x1b7\x1b[5;5H\x1b8")
    expect(b.getCursor().x).toBe(2)
    expect(b.getCursor().y).toBe(0)
  })
})
