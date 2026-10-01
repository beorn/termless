import { createHash } from "node:crypto"
import { existsSync, writeFileSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, test, vi } from "vitest"
import { PUBLISH_ORDER, publishWorkspaces, validatePublishOrder } from "../scripts/publish-workspaces.ts"

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

/**
 * @failure Release repacks or publishes a workspace directory instead of the verified archive, or accepts an incomplete/changed verifier receipt.
 * @level l2
 * @consumer Termless release publisher
 * @testonly none
 */
describe("verified archive handoff", () => {
  const encoder = new TextEncoder()
  const stream = (value: string) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(value))
        controller.close()
      },
    })
  const child = (exitCode: number, stdout = "", stderr = "") =>
    ({ exited: Promise.resolve(exitCode), stdout: stream(stdout), stderr: stream(stderr) }) as never

  async function capturePublish(mode: "valid" | "missing" | "digest") {
    const root = resolve(import.meta.dirname, "..")
    const inventory = await validatePublishOrder(root)
    const target = inventory[0]!
    const commands: string[][] = []
    let outputDir = ""
    let verifiedPath = ""
    let published = false
    vi.stubGlobal("Bun", { spawn: vi.fn(), sleep: vi.fn() })
    const spawn = vi.spyOn(Bun, "spawn").mockImplementation((args) => {
      const command = args as string[]
      commands.push(command)
      if (command[0] === "bunx" && command.includes("verify-publishable")) {
        outputDir = command[command.indexOf("--output-dir") + 1]!
        const packages = inventory.map(({ name, version }, index) => {
          const tarballPath = join(outputDir, `${index.toString().padStart(4, "0")}.tgz`)
          const bytes = encoder.encode(`${name}@${version}`)
          writeFileSync(tarballPath, bytes)
          if (name === target.name) verifiedPath = tarballPath
          const sha512 = `sha512-${createHash("sha512").update(bytes).digest("base64")}`
          return { name, version, tarballPath, sha512 }
        })
        if (mode === "missing") packages.pop()
        if (mode === "digest") packages[0]!.sha512 = `sha512-${Buffer.alloc(64).toString("base64")}`
        return child(0, JSON.stringify({ schema: "verify-publishable/v1", ok: true, packages }))
      }
      if (command[0] === "npm" && command[1] === "view") {
        const nameVersion = command[2]!
        if (nameVersion === `${target.name}@${target.version}` && !published) return child(1, "", "E404")
        return child(0, JSON.stringify(nameVersion.slice(nameVersion.lastIndexOf("@") + 1)))
      }
      if (command[0] === "pnpm" && command[1] === "publish") {
        published = true
        return child(0)
      }
      if (command[0] === "bunx" && command[1] === "tsdown") return child(0)
      return child(1, "", `unexpected process: ${command.join(" ")}`)
    })
    return {
      root,
      target,
      commands,
      spawn,
      get outputDir() {
        return outputDir
      },
      get verifiedPath() {
        return verifiedPath
      },
    }
  }

  test("publishes exactly the verified tarball and removes the handoff directory", async () => {
    const fixture = await capturePublish("valid")
    try {
      await publishWorkspaces(fixture.root)
      const publications = fixture.commands.filter(([binary, verb]) => binary === "pnpm" && verb === "publish")
      expect(publications).toHaveLength(1)
      expect(publications[0]![2]).toBe(fixture.verifiedPath)
      expect(fixture.commands.some(([binary, arg]) => binary === "bunx" && arg === "tsdown")).toBe(false)
      expect(existsSync(fixture.outputDir)).toBe(false)
    } finally {
      fixture.spawn.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  test.each(["missing", "digest"] as const)("rejects %s verifier receipt before publishing", async (mode) => {
    const fixture = await capturePublish(mode)
    try {
      await expect(publishWorkspaces(fixture.root)).rejects.toThrow()
      expect(fixture.commands.some(([binary, verb]) => binary === "pnpm" && verb === "publish")).toBe(false)
      expect(existsSync(fixture.outputDir)).toBe(false)
    } finally {
      fixture.spawn.mockRestore()
      vi.unstubAllGlobals()
    }
  })
})
