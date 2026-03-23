
import { census, feed, expect } from "./_backends.ts"

census("sgr", { spec: "ECMA-48 §8.3.117" }, (b, test) => {
  test("sgr-bold", { meta: { description: "Bold" } }, () => {
    feed(b, "\x1b[1mX")
    expect(b.getCell(0, 0).bold).toBe(true)
  })

  test("sgr-faint", { meta: { description: "Faint/dim" } }, () => {
    feed(b, "\x1b[2mX")
    expect(b.getCell(0, 0).dim).toBe(true)
  })

  test("sgr-italic", { meta: { description: "Italic" } }, () => {
    feed(b, "\x1b[3mX")
    expect(b.getCell(0, 0).italic).toBe(true)
  })

  test("sgr-underline-single", { meta: { description: "Underline single" } }, () => {
    feed(b, "\x1b[4mX")
    expect(!!b.getCell(0, 0).underline).toBe(true)
  })

  test("sgr-underline-double", { meta: { description: "Underline double (SGR 21)" } }, ({ partial }) => {
    feed(b, "\x1b[21mX")
    const cell = b.getCell(0, 0)
    partial(cell.underline, `underline=${cell.underline}, not double`)
    expect(cell.underline).toBe("double")
  })

  test("sgr-underline-curly", { meta: { description: "Underline curly (SGR 4:3)" } }, ({ partial }) => {
    feed(b, "\x1b[4:3mX")
    const cell = b.getCell(0, 0)
    partial(cell.underline, `underline=${cell.underline}, not curly`)
    expect(cell.underline).toBe("curly")
  })

  test("sgr-underline-dotted", { meta: { description: "Underline dotted (SGR 4:4)" } }, ({ partial }) => {
    feed(b, "\x1b[4:4mX")
    const cell = b.getCell(0, 0)
    partial(cell.underline, `underline=${cell.underline}, not dotted`)
    expect(cell.underline).toBe("dotted")
  })

  test("sgr-underline-dashed", { meta: { description: "Underline dashed (SGR 4:5)" } }, ({ partial }) => {
    feed(b, "\x1b[4:5mX")
    const cell = b.getCell(0, 0)
    partial(cell.underline, `underline=${cell.underline}, not dashed`)
    expect(cell.underline).toBe("dashed")
  })

  test("sgr-blink", { meta: { description: "Blink" } }, () => {
    feed(b, "\x1b[5mX")
    expect(b.getCell(0, 0).blink).toBe(true)
  })

  test("sgr-inverse", { meta: { description: "Inverse/reverse video" } }, () => {
    feed(b, "\x1b[7mX")
    expect(b.getCell(0, 0).inverse).toBe(true)
  })

  test("sgr-hidden", { meta: { description: "Hidden/invisible" } }, () => {
    feed(b, "\x1b[8mX")
    expect(b.getCell(0, 0).hidden).toBe(true)
  })

  test("sgr-strikethrough", { meta: { description: "Strikethrough" } }, () => {
    feed(b, "\x1b[9mX")
    expect(b.getCell(0, 0).strikethrough).toBe(true)
  })

  test("sgr-fg-256", { meta: { description: "Foreground 256-color" } }, () => {
    feed(b, "\x1b[38;5;196mX")
    const fg = b.getCell(0, 0).fg
    expect(fg).not.toBeNull()
    expect(fg!.r).toBeGreaterThan(200)
  })

  test("sgr-fg-truecolor", { meta: { description: "Foreground truecolor (24-bit)" } }, () => {
    feed(b, "\x1b[38;2;255;128;0mX")
    expect(b.getCell(0, 0).fg).toEqual({ r: 255, g: 128, b: 0 })
  })

  test("sgr-bg-truecolor", { meta: { description: "Background truecolor (24-bit)" } }, () => {
    feed(b, "\x1b[48;2;0;255;128mX")
    expect(b.getCell(0, 0).bg).toEqual({ r: 0, g: 255, b: 128 })
  })

  test("sgr-reset", { meta: { description: "SGR 0 resets all attributes" } }, () => {
    feed(b, "\x1b[1;3;4mX\x1b[0mY")
    const cell = b.getCell(0, 1)
    expect(cell.bold).toBe(false)
    expect(cell.italic).toBe(false)
    expect(!!cell.underline).toBe(false)
  })
})
