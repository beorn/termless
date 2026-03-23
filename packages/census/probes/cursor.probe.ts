import { census, feed } from "./_backends.ts"

census("cursor", { spec: "ECMA-48 §8.3" }, (b, test) => {
  test("cursor-cup", { meta: { description: "CUP absolute positioning" } }, ({ check }) => {
    feed(b, "\x1b[5;10H")
    check(b.getCursor().x, "column").toBe(9)
    check(b.getCursor().y, "row").toBe(4)
  })

  test("cursor-home", { meta: { description: "Cursor home (0,0)" } }, ({ check }) => {
    feed(b, "ABC\x1b[H")
    check(b.getCursor().x, "column").toBe(0)
    check(b.getCursor().y, "row").toBe(0)
  })

  test("cursor-forward", { meta: { description: "Cursor forward (CUF)" } }, ({ check }) => {
    feed(b, "\x1b[5C")
    check(b.getCursor().x, "moved right 5").toBe(5)
  })

  test("cursor-back", { meta: { description: "Cursor back (CUB)" } }, ({ check }) => {
    feed(b, "ABC\x1b[2D")
    check(b.getCursor().x, "moved back 2").toBe(1)
  })

  test("cursor-down", { meta: { description: "Cursor down (CUD)" } }, ({ check }) => {
    feed(b, "\x1b[3B")
    check(b.getCursor().y, "moved down 3").toBe(3)
  })

  test("cursor-up", { meta: { description: "Cursor up (CUU)" } }, ({ check }) => {
    feed(b, "\x1b[5B\x1b[2A")
    check(b.getCursor().y, "net 3 down").toBe(3)
  })

  test("cursor-hide", { meta: { description: "Cursor hide (DECTCEM)" } }, ({ check }) => {
    feed(b, "\x1b[?25l")
    check(b.getCursor().visible, "hidden").toBe(false)
  })

  test("cursor-save-restore", { meta: { description: "Save/restore (DECSC/DECRC)" } }, ({ check }) => {
    feed(b, "AB\x1b7\x1b[5;5H\x1b8")
    check(b.getCursor().x, "restored column").toBe(2)
    check(b.getCursor().y, "restored row").toBe(0)
  })
})
