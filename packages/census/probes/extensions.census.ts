import { census, feed } from "./_backends.ts"

census("extensions", {}, (b, test) => {
  test("ext-truecolor", { meta: { description: "24-bit truecolor", spec: "SGR 38;2 / 48;2" } }, ({ check }) => {
    check(b.capabilities.truecolor, "truecolor capable").toBe(true)
  })

  test("ext-kitty-keyboard", { meta: { description: "Kitty keyboard protocol", spec: "https://sw.kovidgoyal.net/kitty/keyboard-protocol/" } }, ({ check }) => {
    check(b.capabilities.kittyKeyboard, "kitty keyboard capable").toBe(true)
  })

  test("ext-kitty-graphics", { meta: { description: "Kitty graphics protocol", spec: "https://sw.kovidgoyal.net/kitty/graphics-protocol/" } }, ({ check }) => {
    check(b.capabilities.kittyGraphics, "kitty graphics capable").toBe(true)
  })

  test("ext-sixel", { meta: { description: "Sixel graphics", spec: "DEC Sixel" } }, ({ check }) => {
    check(b.capabilities.sixel, "sixel capable").toBe(true)
  })

  test("ext-osc8", { meta: { description: "OSC 8 hyperlinks", spec: "https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda" } }, ({ check }) => {
    check(b.capabilities.osc8Hyperlinks, "osc8 capable").toBe(true)
  })

  test("ext-reflow", { meta: { description: "Text reflow on resize" } }, ({ check }) => {
    check(b.capabilities.reflow, "reflow capable").toBe(true)
  })

  test("ext-semantic-prompts", { meta: { description: "Semantic prompt markers", spec: "OSC 133" } }, ({ check }) => {
    check(b.capabilities.semanticPrompts, "semantic prompts capable").toBe(true)
  })

  test("ext-osc2-title", { meta: { description: "Window title via OSC 2", spec: "OSC 2" } }, ({ check }) => {
    feed(b, "\x1b]2;Test Title\x07")
    check(b.getTitle(), "title set").toContain("Test Title")
  })
})
