import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative, resolve, sep } from "node:path"

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
  "packages/termless",
] as const

interface PackageManifest {
  name: string
  version: string
  private?: boolean
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

export interface PublishableWorkspace {
  dir: string
  name: string
  version: string
}

interface VerifiedArchive {
  name: string
  version: string
  tarballPath: string
  sha512: string
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
      ...Object.fromEntries(
        Object.entries(manifest.peerDependencies ?? {}).filter(
          ([name]) => manifest.peerDependenciesMeta?.[name]?.optional !== true,
        ),
      ),
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

/**
 * Registry reads and publishes run from the system temp directory, never a workspace: from a package directory npm
 * applies the workspace's devEngines and exits EBADDEVENGINES before it reaches the registry. The tarball path is
 * absolute, so nothing needs the workspace as cwd.
 */
const REGISTRY_CWD = tmpdir()

/** The receipt file a prepared output directory carries beside its archives. */
export const RECEIPT_FILE = "verify-publishable-receipt.json"

async function registryField(name: string, version: string, field: string): Promise<string | null> {
  const result = await runCapture(["npm", "view", `${name}@${version}`, field, "--json"], REGISTRY_CWD)
  if (result.exitCode === 0) return JSON.parse(result.stdout) as string
  if (result.stderr.includes("E404")) return null
  throw new Error(`npm view ${name}@${version} ${field} failed (cwd ${REGISTRY_CWD}):\n${result.stderr}`)
}

async function publishedVersion(name: string, version: string): Promise<string | null> {
  return registryField(name, version, "version")
}

async function waitForPublishedVersion(name: string, version: string): Promise<void> {
  for (let attempt = 1; attempt <= 15; attempt++) {
    if ((await publishedVersion(name, version)) === version) return
    await Bun.sleep(attempt * 1000)
  }
  throw new Error(`${name}@${version} did not resolve from npm after publish`)
}

async function validateArchive(archive: VerifiedArchive, outputDir: string): Promise<void> {
  if (!isAbsolute(archive.tarballPath)) {
    throw new Error(`verified archive path is not absolute: ${archive.name} ${archive.tarballPath}`)
  }
  const path = await realpath(archive.tarballPath)
  const inside = relative(outputDir, path)
  if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new Error(`verified archive escapes output directory: ${archive.name} ${archive.tarballPath}`)
  }
  if (!(await stat(path)).isFile()) throw new Error(`verified archive is not a file: ${archive.name} ${path}`)
  const digest = `sha512-${createHash("sha512")
    .update(await readFile(path))
    .digest("base64")}`
  if (digest !== archive.sha512) {
    throw new Error(
      `verified archive SHA-512 mismatch: ${archive.name} ${path}; expected=${archive.sha512} actual=${digest}`,
    )
  }
}

async function receiptArchives(
  stdout: string,
  stderr: string,
  outputDir: string,
  inventory: PublishableWorkspace[],
): Promise<Map<string, VerifiedArchive>> {
  const result = { stdout, stderr }
  let receipt: unknown
  try {
    receipt = JSON.parse(result.stdout)
  } catch (error) {
    throw new Error(
      `verify-publishable returned malformed JSON: ${String(error)}; stdout=${result.stdout}; stderr=${result.stderr}`,
    )
  }
  if (
    receipt === null ||
    typeof receipt !== "object" ||
    (receipt as { schema?: unknown }).schema !== "verify-publishable/v1" ||
    (receipt as { ok?: unknown }).ok !== true ||
    !Array.isArray((receipt as { packages?: unknown }).packages)
  ) {
    throw new Error(
      `verify-publishable did not return a v1 success package receipt: ${result.stdout}; stderr=${result.stderr}`,
    )
  }
  const packages = (receipt as { packages: unknown[] }).packages
  const expected = new Map(inventory.map(({ name, version }) => [name, version]))
  if (packages.length !== expected.size) {
    throw new Error(`verified package inventory mismatch: expected=${expected.size} actual=${packages.length}`)
  }
  const archives = new Map<string, VerifiedArchive>()
  for (const value of packages) {
    if (value === null || typeof value !== "object") {
      throw new Error(`invalid verified package receipt: ${String(value)}`)
    }
    const archive = value as Partial<VerifiedArchive>
    if (
      typeof archive.name !== "string" ||
      typeof archive.version !== "string" ||
      typeof archive.tarballPath !== "string" ||
      typeof archive.sha512 !== "string" ||
      expected.get(archive.name) !== archive.version ||
      archives.has(archive.name)
    ) {
      throw new Error(`verified package contradicts publish inventory: ${JSON.stringify(value)}`)
    }
    archives.set(archive.name, archive as VerifiedArchive)
  }
  const outputRoot = await realpath(outputDir)
  for (const archive of archives.values()) await validateArchive(archive, outputRoot)
  return archives
}

/**
 * Pack and check every workspace into `outputDir` with the configured verifier, and keep its archives and its receipt
 * there. The directory must be new or empty, so a receipt never mixes with bytes from another run. Nothing is
 * published, and nothing is removed, on success or failure.
 */
export async function prepareWorkspaces(root: string, outputDir: string): Promise<Map<string, VerifiedArchive>> {
  const inventory = await validatePublishOrder(root)
  await mkdir(outputDir, { recursive: true })
  const present = await readdir(outputDir)
  if (present.length > 0) {
    throw new Error(`prepare output directory is not empty: ${outputDir} (${present.slice(0, 5).join(", ")})`)
  }
  const result = await runCapture(
    ["bunx", "--bun", "--no-install", "verify-publishable", "--output-dir", outputDir],
    root,
  )
  await writeFile(join(outputDir, RECEIPT_FILE), result.stdout)
  if (result.exitCode !== 0) {
    throw new Error(
      `verify-publishable failed (${result.exitCode}); output kept in ${outputDir}:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    )
  }
  const archives = await receiptArchives(result.stdout, result.stderr, outputDir, inventory)
  console.log(`🧾 ${archives.size} checked archives and ${RECEIPT_FILE} kept in ${outputDir}`)
  return archives
}

/**
 * Publish the archives a prepared directory holds, in dependency order, revalidating each one's SHA-512 against the
 * receipt immediately before its write. A version already on the registry counts as published only when its
 * registry integrity equals the checked archive's; any other integrity stops the batch before the next write.
 */
export async function publishPrepared(root: string, outputDir: string): Promise<void> {
  const inventory = await validatePublishOrder(root)
  const stdout = await readFile(join(outputDir, RECEIPT_FILE), "utf8")
  const archives = await receiptArchives(stdout, "", outputDir, inventory)
  const outputRoot = await realpath(outputDir)
  for (const { name, version } of inventory) {
    const archive = archives.get(name)
    if (!archive) throw new Error(`verified archive is missing for publish package: ${name}@${version}`)
    await validateArchive(archive, outputRoot)
    if ((await publishedVersion(name, version)) === version) {
      const integrity = await registryField(name, version, "dist.integrity")
      if (integrity !== archive.sha512) {
        throw new Error(
          `${name}@${version} is already published with different bytes: registry ${integrity ?? "(none)"}, checked ${archive.sha512}`,
        )
      }
      console.log(`⏭ ${name}@${version} already published with the checked integrity`)
      continue
    }
    console.log(`📦 Publishing ${name}@${version}`)
    await run(["pnpm", "publish", archive.tarballPath, "--access", "public", "--no-git-checks"], REGISTRY_CWD)
    await waitForPublishedVersion(name, version)
    console.log(`✓ ${name}@${version} resolves from npm`)
  }
}

/** Prepare into a new kept directory, then publish from it. The directory survives either outcome. */
export async function publishWorkspaces(root: string, outputDir?: string): Promise<void> {
  const dir = outputDir ?? (await mkdtemp(join(tmpdir(), "termless-verified-publish-")))
  try {
    await prepareWorkspaces(root, dir)
    await publishPrepared(root, dir)
  } finally {
    console.log(`🗂 checked archives and receipt kept in ${dir}`)
  }
}

/**
 * `publish-workspaces.ts [--root <dir>] [--prepare <dir> | --publish <dir>]`. Bare, it prepares into a new directory
 * and publishes. `--prepare` stops after the check; `--publish` publishes what an earlier `--prepare` kept.
 */
export async function main(argv: readonly string[]): Promise<void> {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag)
    if (index === -1) return undefined
    const next = argv[index + 1]
    if (next === undefined || next.startsWith("--")) throw new Error(`${flag} needs a directory`)
    return resolve(next)
  }
  const known = new Set(["--root", "--prepare", "--publish"])
  const unknown = argv.filter(
    (arg, index) => arg.startsWith("--") && !known.has(arg) && !known.has(argv[index - 1] ?? ""),
  )
  if (unknown.length > 0) throw new Error(`unknown arguments: ${unknown.join(" ")}`)
  const root = value("--root") ?? resolve(import.meta.dirname, "..")
  const prepare = value("--prepare")
  const publish = value("--publish")
  if (prepare !== undefined && publish !== undefined) throw new Error("--prepare and --publish are separate runs")
  if (prepare !== undefined) await prepareWorkspaces(root, prepare)
  else if (publish !== undefined) await publishPrepared(root, publish)
  else await publishWorkspaces(root)
}

if (import.meta.main) {
  await main(process.argv.slice(2))
}
