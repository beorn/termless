import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest"
import { backends, feed, support } from "./_backends.ts"
import type { TerminalBackend } from "./_backends.ts"

for (const [name, factory] of backends) {
  describe(name, () => {
    let b: TerminalBackend
    beforeAll(() => { b = factory(); b.init({ cols: 80, rows: 24 }) })
    afterAll(() => { b.destroy() })
    beforeEach(() => { b.reset() })

    describe("sgr", { meta: { spec: "ECMA-48 §8.3.117" } }, () => {
      test("bold (SGR 1)", { meta: { id: "sgr-bold" } }, () => {
        feed(b, "\x1b[1mX")
        support(b.getCell(0, 0).bold)
      })

      test("faint/dim (SGR 2)", { meta: { id: "sgr-faint" } }, () => {
        feed(b, "\x1b[2mX")
        support(b.getCell(0, 0).dim)
      })

      test("italic (SGR 3)", { meta: { id: "sgr-italic" } }, () => {
        feed(b, "\x1b[3mX")
        support(b.getCell(0, 0).italic)
      })

      test("underline single (SGR 4)", { meta: { id: "sgr-underline-single" } }, () => {
        feed(b, "\x1b[4mX")
        support(!!b.getCell(0, 0).underline)
      })

      test("underline double (SGR 21)", { meta: { id: "sgr-underline-double" } }, () => {
        feed(b, "\x1b[21mX")
        const cell = b.getCell(0, 0)
        support(cell.underline === "double", {
          partial: cell.underline,
          notes: `underline=${cell.underline}, not double`,
        })
      })

      test("underline curly (SGR 4:3)", { meta: { id: "sgr-underline-curly" } }, () => {
        feed(b, "\x1b[4:3mX")
        const cell = b.getCell(0, 0)
        support(cell.underline === "curly", {
          partial: cell.underline,
          notes: `underline=${cell.underline}, not curly`,
        })
      })

      test("underline dotted (SGR 4:4)", { meta: { id: "sgr-underline-dotted" } }, () => {
        feed(b, "\x1b[4:4mX")
        const cell = b.getCell(0, 0)
        support(cell.underline === "dotted", {
          partial: cell.underline,
          notes: `underline=${cell.underline}, not dotted`,
        })
      })

      test("underline dashed (SGR 4:5)", { meta: { id: "sgr-underline-dashed" } }, () => {
        feed(b, "\x1b[4:5mX")
        const cell = b.getCell(0, 0)
        support(cell.underline === "dashed", {
          partial: cell.underline,
          notes: `underline=${cell.underline}, not dashed`,
        })
      })

      test("blink (SGR 5)", { meta: { id: "sgr-blink" } }, () => {
        feed(b, "\x1b[5mX")
        support(b.getCell(0, 0).blink)
      })

      test("inverse (SGR 7)", { meta: { id: "sgr-inverse" } }, () => {
        feed(b, "\x1b[7mX")
        support(b.getCell(0, 0).inverse)
      })

      test("hidden (SGR 8)", { meta: { id: "sgr-hidden" } }, () => {
        feed(b, "\x1b[8mX")
        support(b.getCell(0, 0).hidden)
      })

      test("strikethrough (SGR 9)", { meta: { id: "sgr-strikethrough" } }, () => {
        feed(b, "\x1b[9mX")
        support(b.getCell(0, 0).strikethrough)
      })

      test("fg 256-color", { meta: { id: "sgr-fg-256" } }, () => {
        feed(b, "\x1b[38;5;196mX")
        const fg = b.getCell(0, 0).fg
        support(fg !== null && fg.r > 200)
      })

      test("fg truecolor", { meta: { id: "sgr-fg-truecolor" } }, () => {
        feed(b, "\x1b[38;2;255;128;0mX")
        const fg = b.getCell(0, 0).fg
        support(fg !== null && fg.r === 255 && fg.g === 128 && fg.b === 0)
      })

      test("bg truecolor", { meta: { id: "sgr-bg-truecolor" } }, () => {
        feed(b, "\x1b[48;2;0;255;128mX")
        const bg = b.getCell(0, 0).bg
        support(bg !== null && bg.r === 0 && bg.g === 255 && bg.b === 128)
      })

      test("SGR reset clears all", { meta: { id: "sgr-reset" } }, () => {
        feed(b, "\x1b[1;3;4mX\x1b[0mY")
        const cell = b.getCell(0, 1)
        support(!cell.bold && !cell.italic && !cell.underline)
      })
    })
  })
}
