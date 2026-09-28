#!/usr/bin/env bun
/** Record the Ghostty source and Zig inputs for the addon just copied by build.sh. */

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim()
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex")
}

const [binaryArg, sourceArg, zigVersion] = process.argv.slice(2)
if (!binaryArg || !sourceArg || !/^\d+\.\d+\.\d+/.test(zigVersion ?? "") || process.argv.length !== 5) {
  throw new Error("Usage: write-receipt.ts COPIED_ADDON GHOSTTY_SOURCE ZIG_VERSION")
}

const packageDir = realpathSync(resolve(import.meta.dir, ".."))
const termlessRepo = realpathSync(resolve(packageDir, "../.."))
const binaryPath = realpathSync(binaryArg)
const sourceDir = realpathSync(sourceArg)
if (dirname(binaryPath) !== packageDir) throw new Error(`Addon is outside ghostty-native package: ${binaryPath}`)
if (sourceDir !== realpathSync(join(packageDir, "native", ".ghostty-src"))) {
  throw new Error(`Unexpected Ghostty source checkout: ${sourceDir}`)
}

const dirtyWrapper = git(
  termlessRepo,
  "status",
  "--porcelain",
  "--",
  "packages/ghostty-native/native/build.zig",
  "packages/ghostty-native/native/build.zig.zon",
  "packages/ghostty-native/native/src",
  "packages/ghostty-native/build/build.sh",
  "packages/ghostty-native/build/write-receipt.ts",
)
if (dirtyWrapper) throw new Error(`Cannot attest uncommitted Ghostty addon inputs:\n${dirtyWrapper}`)
const dirtyEngine = git(sourceDir, "status", "--porcelain")
if (dirtyEngine) throw new Error(`Cannot attest modified Ghostty source:\n${dirtyEngine}`)

const sourceCommit = git(sourceDir, "rev-parse", "HEAD")
const tag = git(sourceDir, "describe", "--tags", "--exact-match")
if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error(`Ghostty source has no stable release tag: ${tag}`)
const wrapperSourceCommit = git(termlessRepo, "rev-parse", "HEAD")
const nativeTreeOid = git(termlessRepo, "rev-parse", "HEAD:packages/ghostty-native/native")
const lockSha256 = sha256(readFileSync(join(sourceDir, "flake.lock")))
const buildZonSha256 = sha256(readFileSync(join(packageDir, "native", "build.zig.zon")))
const toolchain = `zig ${zigVersion}`
const buildHash = sha256(
  JSON.stringify({ sourceCommit, wrapperSourceCommit, nativeTreeOid, lockSha256, buildZonSha256, toolchain }),
)
const receipt = {
  sha256: sha256(readFileSync(binaryPath)),
  engineVersion: tag.slice(1),
  sourceCommit,
  buildHash,
  toolchain,
  lockSha256,
  nativeTreeOid,
  wrapperSourceCommit,
  buildZonSha256,
  upstreamTag: tag,
}
const destination = `${binaryPath}.receipt.json`
const temporary = `${destination}.tmp-${process.pid}`
writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`)
renameSync(temporary, destination)
console.log(`Ghostty native build receipt ready: ${destination} (${tag}, ${receipt.sha256})`)
