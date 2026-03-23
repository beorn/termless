import { census, feed } from "./_backends.ts"

census("erase", { spec: "ECMA-48 §8.3.39 (EL), §8.3.40 (ED)" }, (b, test) => {
  test("erase-line-right", { meta: { description: "Erase from cursor right (EL 0)" } }, ({ check }) => {
    feed(b, "XXXXX\x1b[1G\x1b[K")
    const c = b.getCell(0, 0).char
    check(c === "" || c === " ", "cell erased").toBe(true)
  })

  test("erase-line-left", { meta: { description: "Erase from cursor left (EL 1)" } }, ({ check }) => {
    feed(b, "XXXXX\x1b[3G\x1b[1K")
    const c = b.getCell(0, 0).char
    check(c === "" || c === " ", "cell erased").toBe(true)
  })

  test("erase-line-all", { meta: { description: "Erase entire line (EL 2)" } }, ({ check }) => {
    feed(b, "XXXXX\x1b[2K")
    const c = b.getCell(0, 0).char
    check(c === "" || c === " ", "cell erased").toBe(true)
  })

  test("erase-screen-below", { meta: { description: "Erase below cursor (ED 0)" } }, ({ check }) => {
    feed(b, "AAA\r\nBBB\r\nCCC\x1b[H\x1b[J")
    check(b.getText(), "BBB erased").not.toContain("BBB")
  })

  test("erase-screen-all", { meta: { description: "Erase entire screen (ED 2)" } }, ({ check }) => {
    feed(b, "AAA\r\nBBB\r\nCCC\x1b[2J")
    check(b.getText().trim(), "screen empty").toBe("")
  })
})
