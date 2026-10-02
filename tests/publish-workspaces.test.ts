import { createHash } from "node:crypto"
import { existsSync, writeFileSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import {
  PUBLISH_ORDER,
  RECEIPT_FILE,
  prepareWorkspaces,
  publishPrepared,
  publishWorkspaces,
  validatePublishOrder,
} from "../scripts/publish-workspaces.ts"

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
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

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

  async function capturePublish(mode: "valid" | "missing" | "digest" | "same-bytes" | "other-bytes") {
    const root = resolve(import.meta.dirname, "..")
    const inventory = await validatePublishOrder(root)
    const target = inventory[0]!
    const commands: string[][] = []
    const cwds: string[] = []
    const integrity = new Map<string, string>()
    let outputDir = ""
    let verifiedPath = ""
    let published = false
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    // Node needs the fake global; Bun's real global cannot be replaced.
    if (typeof Bun === "undefined") vi.stubGlobal("Bun", { spawn: vi.fn(), sleep: vi.fn() })
    vi.spyOn(Bun, "sleep").mockResolvedValue(undefined)
    vi.spyOn(Bun, "spawn").mockImplementation((args, options) => {
      const command = args as string[]
      commands.push(command)
      cwds.push(String((options as { cwd?: string } | undefined)?.cwd))
      if (command[0] === "bunx" && command.includes("verify-publishable")) {
        outputDir = command[command.indexOf("--output-dir") + 1]!
        const packages = inventory.map(({ name, version }, index) => {
          const tarballPath = join(outputDir, `${index.toString().padStart(4, "0")}.tgz`)
          const bytes = encoder.encode(`${name}@${version}`)
          writeFileSync(tarballPath, bytes)
          if (name === target.name) verifiedPath = tarballPath
          const sha512 = `sha512-${createHash("sha512").update(bytes).digest("base64")}`
          integrity.set(name, sha512)
          return { name, version, tarballPath, sha512 }
        })
        if (mode === "missing") packages.pop()
        if (mode === "digest") packages[0]!.sha512 = `sha512-${Buffer.alloc(64).toString("base64")}`
        return child(0, JSON.stringify({ schema: "verify-publishable/v1", ok: true, packages }))
      }
      if (command[0] === "npm" && command[1] === "view") {
        const nameVersion = command[2]!
        const name = nameVersion.slice(0, nameVersion.lastIndexOf("@"))
        const isTarget = nameVersion === `${target.name}@${target.version}`
        const onRegistry = !isTarget || published || mode === "same-bytes" || mode === "other-bytes"
        if (!onRegistry) return child(1, "", "E404")
        if (command[3] === "dist.integrity") {
          const other = `sha512-${Buffer.alloc(64, 1).toString("base64")}`
          return child(0, JSON.stringify(isTarget && mode === "other-bytes" ? other : integrity.get(name)))
        }
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
      cwds,
      log,
      get outputDir() {
        return outputDir
      },
      get verifiedPath() {
        return verifiedPath
      },
    }
  }

  const registryCommands = (fixture: Awaited<ReturnType<typeof capturePublish>>) =>
    fixture.commands
      .map((command, index) => ({ command, cwd: fixture.cwds[index]! }))
      .filter(({ command: [binary, verb] }) => (binary === "npm" && verb === "view") || binary === "pnpm")

  test("publishes exactly the verified tarball and keeps the checked archives and receipt", async () => {
    const fixture = await capturePublish("valid")
    await publishWorkspaces(fixture.root)
    const publications = fixture.commands.filter(([binary, verb]) => binary === "pnpm" && verb === "publish")
    expect(publications).toHaveLength(1)
    expect(publications[0]![2]).toBe(fixture.verifiedPath)
    expect(fixture.commands.some(([binary, arg]) => binary === "bunx" && arg === "tsdown")).toBe(false)
    expect(existsSync(fixture.verifiedPath), "the published archive is kept").toBe(true)
    expect(JSON.parse(await readFile(join(fixture.outputDir, RECEIPT_FILE), "utf8"))).toMatchObject({
      schema: "verify-publishable/v1",
    })
    expect(fixture.log).toHaveBeenCalledWith(`📦 Publishing ${fixture.target.name}@${fixture.target.version}`)
    expect(fixture.log).toHaveBeenCalledWith(`✓ ${fixture.target.name}@${fixture.target.version} resolves from npm`)
    await rm(fixture.outputDir, { recursive: true, force: true })
  })

  // npm in a package directory applies the workspace's devEngines and exits EBADDEVENGINES before the registry; the
  // same read from a neutral directory reaches it (reproduced from the release tree, 2026-10-02).
  test("every registry read and publish runs from the neutral temp directory, never a workspace", async () => {
    const fixture = await capturePublish("valid")
    await publishWorkspaces(fixture.root)
    const registry = registryCommands(fixture)
    expect(registry.length).toBeGreaterThan(PUBLISH_ORDER.length)
    for (const { command, cwd } of registry) {
      expect(cwd, command.join(" ")).toBe(tmpdir())
    }
    await rm(fixture.outputDir, { recursive: true, force: true })
  })

  test("prepare keeps the checked bytes and publishes nothing; publish later sends those same bytes", async () => {
    const fixture = await capturePublish("valid")
    const dir = await mkdtemp(join(tmpdir(), "termless-prepared-"))
    try {
      await prepareWorkspaces(fixture.root, dir)
      expect(fixture.commands.some(([binary]) => binary === "pnpm" || binary === "npm")).toBe(false)
      await expect(prepareWorkspaces(fixture.root, dir), "a used directory is refused").rejects.toThrow(/not empty/u)
      await publishPrepared(fixture.root, dir)
      const publications = fixture.commands.filter(([binary, verb]) => binary === "pnpm" && verb === "publish")
      expect(publications.map((command) => command[2])).toEqual([fixture.verifiedPath])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("an existing version counts as published only when the registry integrity equals the checked archive", async () => {
    const same = await capturePublish("same-bytes")
    await publishWorkspaces(same.root)
    expect(same.commands.some(([binary, verb]) => binary === "pnpm" && verb === "publish")).toBe(false)
    expect(same.log).toHaveBeenCalledWith(
      `⏭ ${same.target.name}@${same.target.version} already published with the checked integrity`,
    )
    await rm(same.outputDir, { recursive: true, force: true })
    vi.restoreAllMocks()

    const other = await capturePublish("other-bytes")
    await expect(publishWorkspaces(other.root)).rejects.toThrow(/already published with different bytes/u)
    expect(other.commands.some(([binary, verb]) => binary === "pnpm" && verb === "publish")).toBe(false)
    await rm(other.outputDir, { recursive: true, force: true })
  })

  test.each(["missing", "digest"] as const)("rejects %s verifier receipt before publishing", async (mode) => {
    const fixture = await capturePublish(mode)
    await expect(publishWorkspaces(fixture.root)).rejects.toThrow()
    expect(fixture.commands.some(([binary, verb]) => binary === "pnpm" && verb === "publish")).toBe(false)
    expect(existsSync(join(fixture.outputDir, RECEIPT_FILE)), "the failed run's receipt is kept").toBe(true)
    await rm(fixture.outputDir, { recursive: true, force: true })
  })
})
