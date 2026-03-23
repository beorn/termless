import { describeBackends, feed, test, expect } from "./setup.ts"

describeBackends("scrollback", (b) => {
  test("scrollback.accumulate", () => {
    for (let i = 0; i < 30; i++) feed(b, `line ${i}\r\n`)
    expect(b.getScrollback().totalLines).toBeGreaterThan(24)
  })

  test("scrollback.total-lines", () => {
    for (let i = 0; i < 30; i++) feed(b, `line ${i}\r\n`)
    expect(b.getScrollback().totalLines).toBeGreaterThanOrEqual(30)
  })

  test("scrollback.scroll-up", () => {
    feed(b, "TOP\r\n")
    for (let i = 0; i < 23; i++) feed(b, `line\r\n`)
    feed(b, "\x1b[S")
    expect(b.getCell(0, 0).char).not.toBe("T")
  })

  test("scrollback.reverse-index", () => {
    feed(b, "A\r\nB\r\nC")
    feed(b, "\x1b[H\x1bM")
    const c = b.getCell(0, 0).char
    expect(c === "" || c === " ").toBe(true)
  })

  test("scrollback.alt-screen", () => {
    feed(b, "NORMAL")
    feed(b, "\x1b[?1049h")
    expect(b.getMode("altScreen")).toBe(true)
  })
})
