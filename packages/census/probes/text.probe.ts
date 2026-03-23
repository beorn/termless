import { describeBackends, feed, test, expect } from "./setup.ts"

describeBackends("text", (b) => {
  test("text.basic", () => {
    feed(b, "Hello")
    expect(b.getText()).toContain("Hello")
  })

  test("text.newline", () => {
    feed(b, "A\r\nB")
    expect(b.getCell(0, 0).char).toBe("A")
    expect(b.getCell(1, 0).char).toBe("B")
  })

  test("text.wrap", () => {
    feed(b, "X".repeat(85))
    expect(b.getCell(1, 0).char).toBe("X")
  })

  test("text.tab", () => {
    feed(b, "\tX")
    expect(b.getCell(0, 8).char).toBe("X")
  })

  test("text.wide.emoji", () => {
    feed(b, "\u{1f389}")
    expect(b.getCell(0, 0).wide).toBe(true)
  })

  test("text.wide.cjk", () => {
    feed(b, "\u4e2d")
    expect(b.getCell(0, 0).wide).toBe(true)
  })

  test("text.overwrite", () => {
    feed(b, "AB\x1b[1GC")
    expect(b.getCell(0, 0).char).toBe("C")
  })

  test("text.cr", () => {
    feed(b, "AB\rC")
    expect(b.getCell(0, 0).char).toBe("C")
    expect(b.getCell(0, 1).char).toBe("B")
  })
})
