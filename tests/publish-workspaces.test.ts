import { readFile } from "node:fs/promises"
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
      "termless",
    ])
  })

  test("links pure backend workspaces for standalone installs", async () => {
    const root = resolve(import.meta.dirname, "..")
    const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
      devDependencies: Record<string, string>
    }

    expect(manifest.devDependencies).toMatchObject({
      "@termless/vt100": "workspace:*",
      "@termless/vt220": "workspace:*",
      "@termless/vterm": "workspace:*",
      "@termless/xtermjs": "workspace:*",
    })
  })
})
