import { resolve } from "node:path"
import { describe, expect, test } from "vitest"
import { validatePublishOrder } from "../scripts/publish-workspaces.ts"

describe("publish workspace inventory", () => {
  test("contains every public workspace exactly once in dependency order", async () => {
    const root = resolve(import.meta.dirname, "..")
    const inventory = await validatePublishOrder(root)

    expect(inventory.map(({ name }) => name)).toEqual([
      "@termless/core",
      "@termless/alacritty",
      "@termless/ghostty-native",
      "@termless/kitty",
      "@termless/libvterm",
      "@termless/swash-render",
      "@termless/vt100",
      "@termless/vt100-rust",
      "@termless/vt220",
      "@termless/vterm",
      "@termless/web-player",
      "@termless/wezterm",
      "@termless/xtermjs",
      "@termless/ghostty",
      "@termless/peekaboo",
      "@termless/test",
      "@termless/cli",
    ])
  })
})
