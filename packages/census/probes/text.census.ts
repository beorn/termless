import { test } from "vitest"
import { census, feed, expect } from "./_backends.ts"

census("text", {}, (b) => {
  test("text-basic", { meta: { description: "Basic text rendering" } }, () => {
    feed(b, "Hello")
    expect(b.getText()).toContain("Hello")
  })

  test("text-newline", { meta: { description: "CR+LF newline" } }, () => {
    feed(b, "A\r\nB")
    expect(b.getCell(0, 0).char).toBe("A")
    expect(b.getCell(1, 0).char).toBe("B")
  })

  test("text-wrap", { meta: { description: "Line wrap at right margin" } }, () => {
    feed(b, "X".repeat(85))
    expect(b.getCell(1, 0).char).toBe("X")
  })

  test("text-tab", { meta: { description: "Tab stop at column 8" } }, () => {
    feed(b, "\tX")
    expect(b.getCell(0, 8).char).toBe("X")
  })

  test("text-wide-emoji", { meta: { description: "Wide emoji character" } }, () => {
    feed(b, "🎉")
    expect(b.getCell(0, 0).wide).toBe(true)
  })

  test("text-cjk", { meta: { description: "CJK wide character" } }, () => {
    feed(b, "中")
    expect(b.getCell(0, 0).wide).toBe(true)
  })

  test("text-overwrite", { meta: { description: "Overwrite with cursor positioning" } }, () => {
    feed(b, "AB\x1b[1GC")
    expect(b.getCell(0, 0).char).toBe("C")
  })

  test("text-cr", { meta: { description: "Carriage return overwrites" } }, () => {
    feed(b, "AB\rC")
    expect(b.getCell(0, 0).char).toBe("C")
    expect(b.getCell(0, 1).char).toBe("B")
  })
})
