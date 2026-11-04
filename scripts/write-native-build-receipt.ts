#!/usr/bin/env bun
/** Bind an actually copied N-API addon to the source and lock inputs that built it. */

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs"
import { basename, join, relative, resolve, sep } from "node:path"

const upstream = {
  alacritty: "alacritty_terminal",
  wezterm: "tattoy-wezterm-term",
  "vt100-rust": "vt100",
} as const

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim()
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex")
}

const [packageArg, binaryArg] = process.argv.slice(2)
if (!packageArg || !binaryArg || process.argv.length !== 4) {
  throw new Error("Usage: write-native-build-receipt.ts PACKAGE_DIRECTORY COPIED_ADDON")
}
const packageDir = realpathSync(packageArg)
const packageName = basename(packageDir)
if (!(packageName in upstream)) throw new Error(`Unsupported Rust addon package ${packageName}`)
const crateName = upstream[packageName as keyof typeof upstream]
const repo = realpathSync(resolve(packageDir, "../.."))
const packagePath = relative(repo, packageDir).split(sep).join("/")
const binaryPath = realpathSync(resolve(packageDir, binaryArg))
if (!binaryPath.startsWith(`${packageDir}${sep}`)) throw new Error(`Addon is outside package: ${binaryPath}`)
const lockPath = join(packageDir, "native", "Cargo.lock")
git(repo, "ls-files", "--error-unmatch", `${packagePath}/native/Cargo.lock`)
const dirty = git(
  repo,
  "status",
  "--porcelain",
  "--",
  `${packagePath}/native`,
  "scripts/copy-native-addon.sh",
  "scripts/write-native-build-receipt.ts",
)
if (dirty) throw new Error(`Cannot attest uncommitted native build inputs:\n${dirty}`)

const lockBytes = readFileSync(lockPath)
const parsed: unknown = Bun.TOML.parse(lockBytes.toString("utf8"))
if (!record(parsed) || !Array.isArray(parsed.package)) throw new Error(`Invalid Cargo.lock: ${lockPath}`)
const crates = parsed.package.filter((item) => record(item) && item.name === crateName)
if (crates.length !== 1 || !record(crates[0]) || typeof crates[0].version !== "string") {
  throw new Error(`Expected one ${crateName} package in ${lockPath}`)
}
const engineVersion = crates[0].version
const upstreamChecksum = crates[0].checksum
let sourceIdentity: { upstreamChecksum: string } | { sourceKind: "local-vendored-patch"; baseArchiveSha256: string }
if (typeof upstreamChecksum === "string" && /^[0-9a-f]{64}$/.test(upstreamChecksum)) {
  sourceIdentity = { upstreamChecksum }
} else {
  const manifest: unknown = Bun.TOML.parse(readFileSync(join(packageDir, "native", "Cargo.toml"), "utf8"))
  const pkg = record(manifest) && record(manifest.package) ? manifest.package : undefined
  const metadata = pkg && record(pkg.metadata) && record(pkg.metadata.termless) ? pkg.metadata.termless : undefined
  if (
    crates[0].source !== undefined ||
    metadata?.sourceKind !== "local-vendored-patch" ||
    metadata.baseCrate !== crateName ||
    metadata.baseVersion !== engineVersion ||
    typeof metadata.baseArchiveSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(metadata.baseArchiveSha256)
  ) {
    throw new Error(
      `Missing ${crateName} registry checksum in ${lockPath}; local source requires matching package.metadata.termless base provenance`,
    )
  }
  sourceIdentity = { sourceKind: "local-vendored-patch", baseArchiveSha256: metadata.baseArchiveSha256 }
}
const sourceCommit = git(repo, "rev-parse", "HEAD")
const nativeTreeOid = git(repo, "rev-parse", `HEAD:${packagePath}/native`)
if (!/^[0-9a-f]{40}$/.test(sourceCommit) || !/^[0-9a-f]{40}$/.test(nativeTreeOid)) {
  throw new Error("Native source commit or tree hash is invalid")
}
const toolchain = [
  execFileSync("rustc", ["--version"], { encoding: "utf8" }).trim(),
  execFileSync("cargo", ["--version"], { encoding: "utf8" }).trim(),
].join("; ")
const lockSha256 = sha256(lockBytes)
const buildHash = sha256(JSON.stringify({ sourceCommit, nativeTreeOid, lockSha256, toolchain, engineVersion }))
const receipt = {
  sha256: sha256(readFileSync(binaryPath)),
  engineVersion,
  sourceCommit,
  buildHash,
  toolchain,
  lockSha256,
  nativeTreeOid,
  upstreamCrate: crateName,
  ...sourceIdentity,
}
const destination = `${binaryPath}.receipt.json`
const temporary = `${destination}.tmp-${process.pid}`
writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`)
renameSync(temporary, destination)
console.log(`Native build receipt ready: ${destination} (${engineVersion}, ${receipt.sha256})`)
