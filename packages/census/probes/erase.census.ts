
import { census, feed, expect } from "./_backends.ts"

census("erase", { spec: "ECMA-48 §8.3.39 (EL), §8.3.40 (ED)" }, (b, test) => {
  test("erase-line-right", { meta: { description: "Erase line from cursor right (EL 0)" } }, () => {
    feed(b, "XXXXX\x1b[1G\x1b[K")
    const c = b.getCell(0, 0).char
    expect(c === "" || c === " ").toBe(true)
  })

  test("erase-line-left", { meta: { description: "Erase line from cursor left (EL 1)" } }, () => {
    feed(b, "XXXXX\x1b[3G\x1b[1K")
    const c0 = b.getCell(0, 0).char
    expect(c0 === "" || c0 === " ").toBe(true)
  })

  test("erase-line-all", { meta: { description: "Erase entire line (EL 2)" } }, () => {
    feed(b, "XXXXX\x1b[2K")
    const c = b.getCell(0, 0).char
    expect(c === "" || c === " ").toBe(true)
  })

  test("erase-screen-below", { meta: { description: "Erase screen below cursor (ED 0)" } }, () => {
    feed(b, "AAA\r\nBBB\r\nCCC\x1b[H\x1b[J")
    expect(b.getText()).not.toContain("BBB")
  })

  test("erase-screen-all", { meta: { description: "Erase entire screen (ED 2)" } }, () => {
    feed(b, "AAA\r\nBBB\r\nCCC\x1b[2J")
    expect(b.getText().trim()).toBe("")
  })
})
