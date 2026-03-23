import { census, feed } from "./_backends.ts"

census("text", {}, (b, test) => {
  test("text-basic", { meta: { description: "Basic text rendering" } }, ({ check }) => {
    feed(b, "Hello")
    check(b.getText(), "contains text").toContain("Hello")
  })

  test("text-newline", { meta: { description: "CR+LF newline" } }, ({ check }) => {
    feed(b, "A\r\nB")
    check(b.getCell(0, 0).char, "A on row 0").toBe("A")
    check(b.getCell(1, 0).char, "B on row 1").toBe("B")
  })

  test("text-wrap", { meta: { description: "Line wrap at right margin" } }, ({ check }) => {
    feed(b, "X".repeat(85))
    check(b.getCell(1, 0).char, "wrapped to row 1").toBe("X")
  })

  test("text-tab", { meta: { description: "Tab stop at column 8" } }, ({ check }) => {
    feed(b, "\tX")
    check(b.getCell(0, 8).char, "X at col 8").toBe("X")
  })

  test("text-wide-emoji", { meta: { description: "Wide emoji character" } }, ({ check }) => {
    feed(b, "🎉")
    check(b.getCell(0, 0).wide, "emoji is wide").toBe(true)
  })

  test("text-cjk", { meta: { description: "CJK wide character" } }, ({ check }) => {
    feed(b, "中")
    check(b.getCell(0, 0).wide, "CJK is wide").toBe(true)
  })

  test("text-overwrite", { meta: { description: "Overwrite with cursor positioning" } }, ({ check }) => {
    feed(b, "AB\x1b[1GC")
    check(b.getCell(0, 0).char, "overwritten").toBe("C")
  })

  test("text-cr", { meta: { description: "Carriage return overwrites" } }, ({ check }) => {
    feed(b, "AB\rC")
    check(b.getCell(0, 0).char, "CR overwrote A").toBe("C")
    check(b.getCell(0, 1).char, "B preserved").toBe("B")
  })
})
