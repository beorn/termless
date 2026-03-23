import { census, feed } from "./_backends.ts"

census("scrollback", {}, (b, test) => {
  test("scrollback-accumulate", { meta: { description: "Accumulates on overflow" } }, ({ check }) => {
    for (let i = 0; i < 30; i++) feed(b, `line ${i}\r\n`)
    check(b.getScrollback().totalLines, "more than screen height").toBeGreaterThan(24)
  })

  test("scrollback-total-lines", { meta: { description: "Total lines count" } }, ({ check }) => {
    for (let i = 0; i < 30; i++) feed(b, `line ${i}\r\n`)
    check(b.getScrollback().totalLines, "at least 30 lines").toBeGreaterThanOrEqual(30)
  })

  test("scrollback-scroll-up", { meta: { description: "Scroll up (SU) shifts content" } }, ({ check }) => {
    feed(b, "TOP\r\n")
    for (let i = 0; i < 23; i++) feed(b, `line\r\n`)
    feed(b, "\x1b[S")
    check(b.getCell(0, 0).char, "TOP scrolled away").not.toBe("T")
  })

  test("scrollback-reverse-index", { meta: { description: "Reverse index at top" } }, ({ check }) => {
    feed(b, "A\r\nB\r\nC")
    feed(b, "\x1b[H\x1bM")
    const c = b.getCell(0, 0).char
    check(c === "" || c === " ", "row 0 empty after RI").toBe(true)
  })

  test("scrollback-alt-screen", { meta: { description: "Alt screen separates scrollback" } }, ({ check }) => {
    feed(b, "NORMAL")
    feed(b, "\x1b[?1049h")
    check(b.getMode("altScreen"), "entered alt screen").toBe(true)
  })
})
