#!/usr/bin/env bun
/** Record the exact libvterm WASM/JS pair emitted by build.sh. */

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim()
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex")
}

const [sourceArg, wasmArg, jsArg] = process.argv.slice(2)
if (!sourceArg || !wasmArg || !jsArg || process.argv.length !== 5) {
  throw new Error("Usage: write-receipt.ts LIBVTERM_SOURCE BUILT_WASM BUILT_JS")
}
const packageDir = realpathSync(resolve(import.meta.dir, ".."))
const termlessRepo = realpathSync(resolve(packageDir, "../.."))
const sourceDir = realpathSync(sourceArg)
const wasmPath = realpathSync(wasmArg)
const jsPath = realpathSync(jsArg)
if (wasmPath !== join(packageDir, "wasm", "libvterm.wasm") || jsPath !== join(packageDir, "wasm", "libvterm.js")) {
  throw new Error("libvterm receipt paths must name the pair loaded by the adapter")
}
const changedSource = git(sourceDir, "status", "--porcelain", "--untracked-files=no")
if (changedSource) throw new Error(`Tracked libvterm source changed during build:\n${changedSource}`)
const changedWrapper = git(
  termlessRepo,
  "status",
  "--porcelain",
  "--",
  "packages/libvterm/build/build.sh",
  "packages/libvterm/build/flat-api.c",
  "packages/libvterm/build/write-receipt.ts",
)
if (changedWrapper) throw new Error(`Cannot attest uncommitted libvterm build inputs:\n${changedWrapper}`)

const sourceCommit = git(sourceDir, "rev-parse", "HEAD")
const upstreamTag = git(sourceDir, "describe", "--tags", "--exact-match")
if (!/^v\d+\.\d+\.\d+$/.test(upstreamTag)) throw new Error(`libvterm source has no stable tag: ${upstreamTag}`)
const wrapperSourceCommit = git(termlessRepo, "rev-parse", "HEAD")
const wrapperTreeOid = git(termlessRepo, "rev-parse", "HEAD:packages/libvterm/build")
const toolchain = execFileSync("emcc", ["--version"], { encoding: "utf8" }).split("\n")[0]!.trim()
const generatedIncludes = [
  "src/encoding/DECdrawing.inc",
  "src/encoding/uk.inc",
  "src/fullwidth.inc",
].map((path) => [path, sha256(readFileSync(join(sourceDir, path)))])
const buildInputs = {
  sourceCommit,
  wrapperSourceCommit,
  wrapperTreeOid,
  buildScriptSha256: sha256(readFileSync(join(packageDir, "build", "build.sh"))),
  flatApiSha256: sha256(readFileSync(join(packageDir, "build", "flat-api.c"))),
  generatedIncludes,
  toolchain,
}
const receipt = {
  sha256: sha256(readFileSync(wasmPath)),
  jsSha256: sha256(readFileSync(jsPath)),
  engineVersion: upstreamTag.slice(1),
  sourceCommit,
  buildHash: sha256(JSON.stringify(buildInputs)),
  toolchain,
  wrapperSourceCommit,
  wrapperTreeOid,
  upstreamTag,
  buildInputs,
}
const destination = `${wasmPath}.receipt.json`
const temporary = `${destination}.tmp-${process.pid}`
writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`)
renameSync(temporary, destination)
console.log(`libvterm WASM build receipt ready: ${destination} (${upstreamTag}, ${receipt.sha256})`)
