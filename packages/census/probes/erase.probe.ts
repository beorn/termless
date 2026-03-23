import { describeBackends, feed, test, expect } from "./setup.ts"

describeBackends("erase", (b) => {
  test("erase.line.right", () => {
    feed(b, "XXXXX\x1b[1G\x1b[K")
    const c = b.getCell(0, 0).char
    expect(c === "" || c === " ").toBe(true)
  })

  test("erase.line.left", () => {
    feed(b, "XXXXX\x1b[3G\x1b[1K")
    const c = b.getCell(0, 0).char
    expect(c === "" || c === " ").toBe(true)
  })

  test("erase.line.all", () => {
    feed(b, "XXXXX\x1b[2K")
    const c = b.getCell(0, 0).char
    expect(c === "" || c === " ").toBe(true)
  })

  test("erase.screen.below", () => {
    feed(b, "AAA\r\nBBB\r\nCCC\x1b[H\x1b[J")
    expect(b.getText()).not.toContain("BBB")
  })

  test("erase.screen.all", () => {
    feed(b, "AAA\r\nBBB\r\nCCC\x1b[2J")
    expect(b.getText().trim()).toBe("")
  })
})
