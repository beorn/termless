import { describeBackends, feed, test, expect } from "./setup.ts"

describeBackends("extensions", (b) => {
  test("extensions.truecolor", () => {
    expect(b.capabilities.truecolor).toBe(true)
  })

  test("extensions.kitty-keyboard", () => {
    expect(b.capabilities.kittyKeyboard).toBe(true)
  })

  test("extensions.kitty-graphics", () => {
    expect(b.capabilities.kittyGraphics).toBe(true)
  })

  test("extensions.sixel", () => {
    expect(b.capabilities.sixel).toBe(true)
  })

  test("extensions.osc8", () => {
    expect(b.capabilities.osc8Hyperlinks).toBe(true)
  })

  test("extensions.reflow", () => {
    expect(b.capabilities.reflow).toBe(true)
  })

  test("extensions.semantic-prompts", () => {
    expect(b.capabilities.semanticPrompts).toBe(true)
  })

  test("extensions.osc2-title", () => {
    feed(b, "\x1b]2;Test Title\x07")
    expect(b.getTitle()).toContain("Test Title")
  })
})
