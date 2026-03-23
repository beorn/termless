import { describeBackends, feed, test, expect } from "./setup.ts"

describeBackends("sgr", (b) => {
  test("sgr.bold", () => {
    feed(b, "\x1b[1mX")
    expect(b.getCell(0, 0).bold).toBe(true)
  })

  test("sgr.faint", () => {
    feed(b, "\x1b[2mX")
    expect(b.getCell(0, 0).dim).toBe(true)
  })

  test("sgr.italic", () => {
    feed(b, "\x1b[3mX")
    expect(b.getCell(0, 0).italic).toBe(true)
  })

  test("sgr.underline.single", () => {
    feed(b, "\x1b[4mX")
    expect(b.getCell(0, 0).underline).toBeTruthy()
  })

  test("sgr.underline.double", () => {
    feed(b, "\x1b[21mX")
    const cell = b.getCell(0, 0)
    expect(cell.underline).toBeTruthy()
    expect(cell.underline).toBe("double")
  })

  test("sgr.underline.curly", () => {
    feed(b, "\x1b[4:3mX")
    const cell = b.getCell(0, 0)
    expect(cell.underline).toBeTruthy()
    expect(cell.underline).toBe("curly")
  })

  test("sgr.underline.dotted", () => {
    feed(b, "\x1b[4:4mX")
    const cell = b.getCell(0, 0)
    expect(cell.underline).toBeTruthy()
    expect(cell.underline).toBe("dotted")
  })

  test("sgr.underline.dashed", () => {
    feed(b, "\x1b[4:5mX")
    const cell = b.getCell(0, 0)
    expect(cell.underline).toBeTruthy()
    expect(cell.underline).toBe("dashed")
  })

  test("sgr.blink", () => {
    feed(b, "\x1b[5mX")
    expect(b.getCell(0, 0).blink).toBe(true)
  })

  test("sgr.inverse", () => {
    feed(b, "\x1b[7mX")
    expect(b.getCell(0, 0).inverse).toBe(true)
  })

  test("sgr.hidden", () => {
    feed(b, "\x1b[8mX")
    expect(b.getCell(0, 0).hidden).toBe(true)
  })

  test("sgr.strikethrough", () => {
    feed(b, "\x1b[9mX")
    expect(b.getCell(0, 0).strikethrough).toBe(true)
  })

  test("sgr.fg.256", () => {
    feed(b, "\x1b[38;5;196mX")
    const fg = b.getCell(0, 0).fg
    expect(fg).not.toBeNull()
    expect(fg?.r).toBeGreaterThan(200)
  })

  test("sgr.fg.truecolor", () => {
    feed(b, "\x1b[38;2;255;128;0mX")
    const fg = b.getCell(0, 0).fg
    expect(fg).not.toBeNull()
    expect(fg).toEqual({ r: 255, g: 128, b: 0 })
  })

  test("sgr.bg.truecolor", () => {
    feed(b, "\x1b[48;2;0;255;128mX")
    const bg = b.getCell(0, 0).bg
    expect(bg).not.toBeNull()
    expect(bg).toEqual({ r: 0, g: 255, b: 128 })
  })

  test("sgr.reset", () => {
    feed(b, "\x1b[1;3;4mX\x1b[0mY")
    const cell = b.getCell(0, 1)
    expect(cell.bold).toBe(false)
    expect(cell.italic).toBe(false)
    expect(!!cell.underline).toBe(false)
  })
})
