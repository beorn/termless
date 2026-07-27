import { readdir, readFile } from "node:fs/promises"
import { join, resolve } from "node:path"

export const PUBLISH_ORDER = [
  ".",
  "packages/alacritty",
  "packages/ghostty-native",
  "packages/kitty",
  "packages/libvterm",
  "packages/swash-render",
  "packages/vt100",
  "packages/vt100-rust",
  "packages/vt220",
  "packages/vterm",
  "packages/web-player",
  "packages/wezterm",
  "packages/xtermjs",
  "packages/ghostty",
  "packages/peekaboo",
  "packages/viterm",
  "packages/cli",
] as const

interface PackageManifest {
  name: string
  version: string
  private?: boolean
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

export interface PublishableWorkspace {
  dir: string
  name: string
  version: string
}

async function readManifest(root: string, dir: string): Promise<PackageManifest> {
  const path = join(root, dir, "package.json")
  return JSON.parse(await readFile(path, "utf8")) as PackageManifest
}

async function discoverPublicWorkspaceDirs(root: string): Promise<string[]> {
  const packageEntries = await readdir(join(root, "packages"), { withFileTypes: true })
  const dirs = ["."]

  for (const entry of packageEntries) {
    if (!entry.isDirectory()) continue
    const dir = `packages/${entry.name}`
    const manifest = await readManifest(root, dir)
    if (!manifest.private) dirs.push(dir)
  }

  return dirs
}

export async function validatePublishOrder(root: string): Promise<PublishableWorkspace[]> {
  const discovered = await discoverPublicWorkspaceDirs(root)
  const ordered = [...PUBLISH_ORDER]
  const duplicates = ordered.filter((dir, index) => ordered.indexOf(dir) !== index)
  const missing = discovered.filter((dir) => !ordered.includes(dir as (typeof PUBLISH_ORDER)[number]))
  const unknown = ordered.filter((dir) => !discovered.includes(dir))

  if (duplicates.length > 0 || missing.length > 0 || unknown.length > 0) {
    throw new Error(
      [
        duplicates.length > 0 ? `duplicate publish dirs: ${duplicates.join(", ")}` : "",
        missing.length > 0 ? `unlisted public workspaces: ${missing.join(", ")}` : "",
        unknown.length > 0 ? `unknown publish dirs: ${unknown.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    )
  }

  const manifests = await Promise.all(ordered.map(async (dir) => ({ dir, manifest: await readManifest(root, dir) })))
  const packageIndex = new Map(manifests.map(({ manifest }, index) => [manifest.name, index]))

  for (const [index, { dir, manifest }] of manifests.entries()) {
    const localDependencies = {
      ...manifest.dependencies,
      ...manifest.peerDependencies,
    }
    for (const dependency of Object.keys(localDependencies)) {
      const dependencyIndex = packageIndex.get(dependency)
      if (dependencyIndex !== undefined && dependencyIndex >= index) {
        throw new Error(`${manifest.name} (${dir}) must publish after local dependency ${dependency}`)
      }
    }
  }

  return manifests.map(({ dir, manifest }) => ({
    dir,
    name: manifest.name,
    version: manifest.version,
  }))
}

interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

async function runCapture(args: string[], cwd: string): Promise<CommandResult> {
  const process = Bun.spawn(args, {
    cwd,
    env: globalThis.process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

async function run(args: string[], cwd: string): Promise<void> {
  const process = Bun.spawn(args, {
    cwd,
    env: globalThis.process.env,
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await process.exited
  if (exitCode !== 0) throw new Error(`${args.join(" ")} failed with exit code ${exitCode}`)
}

async function publishedVersion(name: string, version: string, cwd: string): Promise<string | null> {
  const result = await runCapture(["npm", "view", `${name}@${version}`, "version", "--json"], cwd)
  if (result.exitCode === 0) return JSON.parse(result.stdout) as string
  if (result.stderr.includes("E404")) return null
  throw new Error(`npm view ${name}@${version} failed:\n${result.stderr}`)
}

async function waitForPublishedVersion(name: string, version: string, cwd: string): Promise<void> {
  for (let attempt = 1; attempt <= 15; attempt++) {
    if ((await publishedVersion(name, version, cwd)) === version) return
    await Bun.sleep(attempt * 1000)
  }
  throw new Error(`${name}@${version} did not resolve from npm after publish`)
}

export async function publishWorkspaces(root: string): Promise<void> {
  const inventory = await validatePublishOrder(root)

  for (const { dir, name, version } of inventory) {
    const cwd = resolve(root, dir)
    if ((await publishedVersion(name, version, cwd)) === version) {
      console.log(`⏭ ${name}@${version} already published`)
      continue
    }

    console.log(`🔨 Building ${name}@${version}`)
    await run(["bunx", "tsdown"], cwd)
    console.log(`📦 Publishing ${name}@${version}`)
    await run(["pnpm", "publish", "--access", "public", "--no-git-checks"], cwd)
    await waitForPublishedVersion(name, version, cwd)
    console.log(`✓ ${name}@${version} resolves from npm`)
  }
}

if (import.meta.main) {
  await publishWorkspaces(resolve(import.meta.dirname, ".."))
}
