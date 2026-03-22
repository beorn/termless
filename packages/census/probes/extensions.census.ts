import { describe, test, beforeAll, afterAll, beforeEach } from "vitest"
import { backends, feed, support } from "./_backends.ts"
import type { TerminalBackend } from "./_backends.ts"

for (const [name, factory] of backends) {
  describe(name, () => {
    let b: TerminalBackend
    beforeAll(() => { b = factory(); b.init({ cols: 80, rows: 24 }) })
    afterAll(() => { b.destroy() })
    beforeEach(() => { b.reset() })

    describe("extensions", () => {
      test("truecolor", { meta: { id: "ext-truecolor", spec: "SGR 38;2 / 48;2" } }, () => {
        support(b.capabilities.truecolor)
      })

      test("Kitty keyboard protocol", { meta: { id: "ext-kitty-keyboard", spec: "https://sw.kovidgoyal.net/kitty/keyboard-protocol/" } }, () => {
        support(b.capabilities.kittyKeyboard)
      })

      test("Kitty graphics protocol", { meta: { id: "ext-kitty-graphics", spec: "https://sw.kovidgoyal.net/kitty/graphics-protocol/" } }, () => {
        support(b.capabilities.kittyGraphics)
      })

      test("sixel graphics", { meta: { id: "ext-sixel", spec: "DEC Sixel" } }, () => {
        support(b.capabilities.sixel)
      })

      test("OSC 8 hyperlinks", { meta: { id: "ext-osc8", spec: "https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda" } }, () => {
        support(b.capabilities.osc8Hyperlinks)
      })

      test("reflow on resize", { meta: { id: "ext-reflow" } }, () => {
        support(b.capabilities.reflow)
      })

      test("semantic prompts", { meta: { id: "ext-semantic-prompts", spec: "OSC 133" } }, () => {
        support(b.capabilities.semanticPrompts)
      })

      test("OSC 2 title", { meta: { id: "ext-osc2-title", spec: "OSC 2" } }, () => {
        feed(b, "\x1b]2;Test Title\x07")
        support(b.getTitle().includes("Test Title"))
      })
    })
  })
}
