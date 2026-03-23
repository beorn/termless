
import { census, feed, expect } from "./_backends.ts"

census("cursor", { spec: "ECMA-48 §8.3" }, (b, test) => {
  test("cursor-cup", { meta: { description: "CUP absolute positioning" } }, () => {
    feed(b, "\x1b[5;10H")
    expect(b.getCursor().x).toBe(9)
    expect(b.getCursor().y).toBe(4)
  })

  test("cursor-home", { meta: { description: "Cursor home (0,0)" } }, () => {
    feed(b, "ABC\x1b[H")
    expect(b.getCursor().x).toBe(0)
    expect(b.getCursor().y).toBe(0)
  })

  test("cursor-forward", { meta: { description: "Cursor forward (CUF)" } }, () => {
    feed(b, "\x1b[5C")
    expect(b.getCursor().x).toBe(5)
  })

  test("cursor-back", { meta: { description: "Cursor back (CUB)" } }, () => {
    feed(b, "ABC\x1b[2D")
    expect(b.getCursor().x).toBe(1)
  })

  test("cursor-down", { meta: { description: "Cursor down (CUD)" } }, () => {
    feed(b, "\x1b[3B")
    expect(b.getCursor().y).toBe(3)
  })

  test("cursor-up", { meta: { description: "Cursor up (CUU)" } }, () => {
    feed(b, "\x1b[5B\x1b[2A")
    expect(b.getCursor().y).toBe(3)
  })

  test("cursor-hide", { meta: { description: "Cursor hide (DECTCEM)" } }, () => {
    feed(b, "\x1b[?25l")
    expect(b.getCursor().visible).toBe(false)
  })

  test("cursor-save-restore", { meta: { description: "Cursor save/restore (DECSC/DECRC)" } }, () => {
    feed(b, "AB\x1b7\x1b[5;5H\x1b8")
    expect(b.getCursor().x).toBe(2)
    expect(b.getCursor().y).toBe(0)
  })
})
