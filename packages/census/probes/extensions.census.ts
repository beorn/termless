import { test } from "vitest"
import { census, feed, expect } from "./_backends.ts"

census("extensions", {}, (b) => {
  test("ext-truecolor", { meta: { description: "24-bit truecolor support", spec: "SGR 38;2 / 48;2" } }, () => {
    expect(b.capabilities.truecolor).toBe(true)
  })

  test("ext-kitty-keyboard", { meta: { description: "Kitty keyboard protocol", spec: "https://sw.kovidgoyal.net/kitty/keyboard-protocol/" } }, () => {
    expect(b.capabilities.kittyKeyboard).toBe(true)
  })

  test("ext-kitty-graphics", { meta: { description: "Kitty graphics protocol", spec: "https://sw.kovidgoyal.net/kitty/graphics-protocol/" } }, () => {
    expect(b.capabilities.kittyGraphics).toBe(true)
  })

  test("ext-sixel", { meta: { description: "Sixel graphics", spec: "DEC Sixel" } }, () => {
    expect(b.capabilities.sixel).toBe(true)
  })

  test("ext-osc8", { meta: { description: "OSC 8 hyperlinks", spec: "https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda" } }, () => {
    expect(b.capabilities.osc8Hyperlinks).toBe(true)
  })

  test("ext-reflow", { meta: { description: "Text reflow on resize" } }, () => {
    expect(b.capabilities.reflow).toBe(true)
  })

  test("ext-semantic-prompts", { meta: { description: "Semantic prompt markers", spec: "OSC 133" } }, () => {
    expect(b.capabilities.semanticPrompts).toBe(true)
  })

  test("ext-osc2-title", { meta: { description: "Window title via OSC 2", spec: "OSC 2" } }, () => {
    feed(b, "\x1b]2;Test Title\x07")
    expect(b.getTitle()).toContain("Test Title")
  })
})
