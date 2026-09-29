import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, test } from "vitest"
import { PUBLISH_ORDER, validatePublishOrder } from "../scripts/publish-workspaces.ts"

async function withWorkspaceManifests(run: (root: string) => Promise<void>): Promise<void> {
  const source = resolve(import.meta.dirname, "..")
  const root = await mkdtemp(join(tmpdir(), "termless-publish-order-"))
  try {
    for (const dir of PUBLISH_ORDER) {
      await mkdir(resolve(root, dir), { recursive: true })
      await writeFile(resolve(root, dir, "package.json"), await readFile(resolve(source, dir, "package.json")))
    }
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function writeCoreDependencies(root: string, optional: unknown, direct: boolean): Promise<void> {
  const path = resolve(root, "package.json")
  const manifest = JSON.parse(await readFile(path, "utf8")) as {
    dependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    peerDependenciesMeta?: Record<string, { optional: unknown }>
  }
  manifest.peerDependencies = { "@termless/ghostty": "^0.9.2" }
  manifest.peerDependenciesMeta = optional === undefined ? undefined : { "@termless/ghostty": { optional } }
  manifest.dependencies = direct ? { ...manifest.dependencies, "@termless/ghostty": "^0.9.2" } : manifest.dependencies
  await writeFile(path, JSON.stringify(manifest))
}

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

  /**
   * @failure Optional peers create false publication cycles, or malformed metadata drops mandatory edges.
   * @level l0
   * @consumer release publication order validator
   * @testonly none
   */
  test.each([
    { metadata: "boolean true", optional: true, accepted: true },
    { metadata: "absent", optional: undefined, accepted: false },
    { metadata: "boolean false", optional: false, accepted: false },
    { metadata: "string true", optional: "true", accepted: false },
  ])("treats $metadata peer metadata according to its mandatory publication edge", async ({ optional, accepted }) => {
    await withWorkspaceManifests(async (root) => {
      await writeCoreDependencies(root, optional, false)
      if (accepted) {
        const inventory = await validatePublishOrder(root)
        expect(inventory[0]?.name).toBe("@termless/core")
        expect(inventory.findIndex(({ name }) => name === "@termless/ghostty")).toBeGreaterThan(0)
      } else {
        await expect(validatePublishOrder(root)).rejects.toThrow(
          "@termless/core (.) must publish after local dependency @termless/ghostty",
        )
      }
    })
  })

  /**
   * @failure Optional peer metadata erases a same-name direct dependency publication edge.
   * @level l0
   * @consumer release publication order validator
   * @testonly none
   */
  test("keeps a direct dependency mandatory when its same-name peer is optional", async () => {
    await withWorkspaceManifests(async (root) => {
      await writeCoreDependencies(root, true, true)
      await expect(validatePublishOrder(root)).rejects.toThrow(
        "@termless/core (.) must publish after local dependency @termless/ghostty",
      )
    })
  })

  /**
   * @failure Optional-peer handling bypasses public workspace inventory validation.
   * @level l0
   * @consumer release publication inventory validator
   * @testonly none
   */
  test("refuses an unlisted public workspace even when the peer cycle is optional", async () => {
    await withWorkspaceManifests(async (root) => {
      await writeCoreDependencies(root, true, false)
      const dir = resolve(root, "packages/unlisted")
      await mkdir(dir)
      await writeFile(resolve(dir, "package.json"), JSON.stringify({ name: "@termless/unlisted", version: "0.9.2" }))
      await expect(validatePublishOrder(root)).rejects.toThrow("unlisted public workspaces: packages/unlisted")
    })
  })
})
