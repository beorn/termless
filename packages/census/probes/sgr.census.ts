import { census, feed } from "./_backends.ts"

census("sgr", { spec: "ECMA-48 §8.3.117" }, (b, test) => {
  test("sgr-bold", { meta: { description: "Bold" } }, ({ check }) => {
    feed(b, "\x1b[1mX")
    check(b.getCell(0, 0).bold, "bold attribute").toBe(true)
  })

  test("sgr-faint", { meta: { description: "Faint/dim" } }, ({ check }) => {
    feed(b, "\x1b[2mX")
    check(b.getCell(0, 0).dim, "dim attribute").toBe(true)
  })

  test("sgr-italic", { meta: { description: "Italic" } }, ({ check }) => {
    feed(b, "\x1b[3mX")
    check(b.getCell(0, 0).italic, "italic attribute").toBe(true)
  })

  test("sgr-underline-single", { meta: { description: "Underline single" } }, ({ check }) => {
    feed(b, "\x1b[4mX")
    check(b.getCell(0, 0).underline, "underline attribute").toBeTruthy()
  })

  test("sgr-underline-double", { meta: { description: "Underline double (SGR 21)" } }, ({ check }) => {
    feed(b, "\x1b[21mX")
    const cell = b.getCell(0, 0)
    check(cell.underline, "has underline").toBeTruthy()
    check(cell.underline, "double variant").toBe("double")
  })

  test("sgr-underline-curly", { meta: { description: "Underline curly (SGR 4:3)" } }, ({ check }) => {
    feed(b, "\x1b[4:3mX")
    const cell = b.getCell(0, 0)
    check(cell.underline, "has underline").toBeTruthy()
    check(cell.underline, "curly variant").toBe("curly")
  })

  test("sgr-underline-dotted", { meta: { description: "Underline dotted (SGR 4:4)" } }, ({ check }) => {
    feed(b, "\x1b[4:4mX")
    const cell = b.getCell(0, 0)
    check(cell.underline, "has underline").toBeTruthy()
    check(cell.underline, "dotted variant").toBe("dotted")
  })

  test("sgr-underline-dashed", { meta: { description: "Underline dashed (SGR 4:5)" } }, ({ check }) => {
    feed(b, "\x1b[4:5mX")
    const cell = b.getCell(0, 0)
    check(cell.underline, "has underline").toBeTruthy()
    check(cell.underline, "dashed variant").toBe("dashed")
  })

  test("sgr-blink", { meta: { description: "Blink" } }, ({ check }) => {
    feed(b, "\x1b[5mX")
    check(b.getCell(0, 0).blink, "blink attribute").toBe(true)
  })

  test("sgr-inverse", { meta: { description: "Inverse/reverse video" } }, ({ check }) => {
    feed(b, "\x1b[7mX")
    check(b.getCell(0, 0).inverse, "inverse attribute").toBe(true)
  })

  test("sgr-hidden", { meta: { description: "Hidden/invisible" } }, ({ check }) => {
    feed(b, "\x1b[8mX")
    check(b.getCell(0, 0).hidden, "hidden attribute").toBe(true)
  })

  test("sgr-strikethrough", { meta: { description: "Strikethrough" } }, ({ check }) => {
    feed(b, "\x1b[9mX")
    check(b.getCell(0, 0).strikethrough, "strikethrough attribute").toBe(true)
  })

  test("sgr-fg-256", { meta: { description: "Foreground 256-color" } }, ({ check }) => {
    feed(b, "\x1b[38;5;196mX")
    const fg = b.getCell(0, 0).fg
    check(fg, "fg color set").not.toBeNull()
    check(fg?.r, "red channel > 200").toBeGreaterThan(200)
  })

  test("sgr-fg-truecolor", { meta: { description: "Foreground 24-bit truecolor" } }, ({ check }) => {
    feed(b, "\x1b[38;2;255;128;0mX")
    const fg = b.getCell(0, 0).fg
    check(fg, "fg color set").not.toBeNull()
    check(fg, "exact RGB match").toEqual({ r: 255, g: 128, b: 0 })
  })

  test("sgr-bg-truecolor", { meta: { description: "Background 24-bit truecolor" } }, ({ check }) => {
    feed(b, "\x1b[48;2;0;255;128mX")
    const bg = b.getCell(0, 0).bg
    check(bg, "bg color set").not.toBeNull()
    check(bg, "exact RGB match").toEqual({ r: 0, g: 255, b: 128 })
  })

  test("sgr-reset", { meta: { description: "SGR 0 resets all attributes" } }, ({ check }) => {
    feed(b, "\x1b[1;3;4mX\x1b[0mY")
    const cell = b.getCell(0, 1)
    check(cell.bold, "bold cleared").toBe(false)
    check(cell.italic, "italic cleared").toBe(false)
    check(!!cell.underline, "underline cleared").toBe(false)
  })
})
