/**
 * @failure A maintained local crate is mislabeled as registry bytes, or missing registry provenance is accepted.
 * @level l2
 * @consumer Native addon receipt writer and the unchanged Terminfo sidecar reader.
 * @testonly none
 */
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { expect, test } from "vitest"

// Exercise the actual CLI, including committed-tree/lock binding. Version commands are fixture facts;
// this test attests receipt representation, not a compiled native artifact.
test("native receipts distinguish declared local source and preserve registry provenance", () => {
  const root = mkdtempSync(join(tmpdir(), "termless-native-receipt-"))
  // A commit hook supplies GIT_DIR/GIT_INDEX_FILE for its caller. The fixture owns a separate repository.
  const fixtureEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")))
  const packageDir = join(root, "packages/wezterm"),
    nativeDir = join(packageDir, "native")
  mkdirSync(nativeDir, { recursive: true })
  // Version strings are fixture facts on every OS; Git and receipt writes remain real.
  // A Bun preload avoids platform-specific shell executables and PATH separators.
  const versions = join(root, "versions.ts")
  writeFileSync(
    versions,
    `
import { mock } from "bun:test"
import { execFileSync } from "node:child_process"
const realExecFileSync = execFileSync
mock.module("node:child_process", () => ({
  execFileSync: (file, args, options) =>
    (file === "rustc" || file === "cargo") && args.length === 1 && args[0] === "--version"
      ? file + " receipt-fixture\\n"
      : realExecFileSync(file, args, options),
}))
`,
  )
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: fixtureEnv }).trim()
  git("init", "--quiet")
  const checksum = "7f3678674adc87f210ec01e2134e1972d6b0bd194bf82242f7e7beee3ae9dbd8"
  const binary = join(packageDir, "termless-wezterm.node")
  writeFileSync(binary, "receipt fixture bytes")
  const localMetadata = `[package.metadata.termless]\nsourceKind = "local-vendored-patch"\nbaseCrate = "tattoy-wezterm-term"\nbaseVersion = "0.1.0-fork.5"\nbaseArchiveSha256 = "${checksum}"\n`
  const writer = resolve(import.meta.dirname, "../scripts/write-native-build-receipt.ts")
  const write = (registry: boolean, metadata: string, checksumPresent = registry) => {
    writeFileSync(
      join(nativeDir, "Cargo.toml"),
      `[package]\nname = "termless-wezterm-native"\nversion = "0.1.0"\n${metadata}`,
    )
    writeFileSync(
      join(nativeDir, "Cargo.lock"),
      `version = 4\n[[package]]\nname = "tattoy-wezterm-term"\nversion = "0.1.0-fork.5"\n${registry ? 'source = "registry+https://github.com/rust-lang/crates.io-index"\n' : ""}${checksumPresent ? `checksum = "${checksum}"\n` : ""}`,
    )
    git("add", "packages/wezterm/native")
    git(
      "-c",
      "user.name=Receipt Fixture",
      "-c",
      "user.email=receipt@example.test",
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "fixture inputs",
    )
    return spawnSync(process.execPath, ["--preload", versions, writer, packageDir, "termless-wezterm.node"], {
      encoding: "utf8",
      env: fixtureEnv,
    })
  }
  const registryResult = write(true, "")
  expect(registryResult.status, registryResult.stderr).toBe(0)
  const registry = JSON.parse(readFileSync(`${binary}.receipt.json`, "utf8"))
  if (typeof registry !== "object" || registry === null) throw new Error("Receipt fixture did not produce an object")
  expect(Object.keys(registry).sort()).toEqual(
    [
      "sha256",
      "engineVersion",
      "sourceCommit",
      "buildHash",
      "toolchain",
      "lockSha256",
      "nativeTreeOid",
      "upstreamCrate",
      "upstreamChecksum",
    ].sort(),
  )
  expect(registry).toHaveProperty("upstreamChecksum", checksum)
  expect(registry).toHaveProperty("toolchain", "rustc receipt-fixture; cargo receipt-fixture")
  // Native-separator containment must still reject a real addon outside the selected package.
  const outsideBinary = join(root, "outside.node")
  writeFileSync(outsideBinary, "outside receipt fixture bytes")
  const outside = spawnSync(process.execPath, ["--preload", versions, writer, packageDir, outsideBinary], {
    encoding: "utf8",
    env: fixtureEnv,
  })
  expect(outside.status).not.toBe(0)
  expect(outside.stderr).toContain("Addon is outside package")
  const localResult = write(false, localMetadata)
  expect(localResult.status, localResult.stderr).toBe(0)
  const local = JSON.parse(readFileSync(`${binary}.receipt.json`, "utf8"))
  expect(local).toMatchObject({
    sourceKind: "local-vendored-patch",
    baseArchiveSha256: checksum,
    upstreamCrate: "tattoy-wezterm-term",
    engineVersion: "0.1.0-fork.5",
  })
  expect(local).not.toHaveProperty("upstreamChecksum")
  expect(local).toHaveProperty("sourceCommit", git("rev-parse", "HEAD"))
  expect(local).toHaveProperty("nativeTreeOid", git("rev-parse", "HEAD:packages/wezterm/native"))
  const registryWithoutChecksum = write(true, localMetadata, false)
  expect(registryWithoutChecksum.status).not.toBe(0)
  expect(registryWithoutChecksum.stderr).toContain("registry checksum")
  for (const metadata of [
    "",
    localMetadata.replace('baseCrate = "tattoy-wezterm-term"', 'baseCrate = "other"'),
    localMetadata.replace('baseVersion = "0.1.0-fork.5"', 'baseVersion = "wrong"'),
  ]) {
    const missing = write(false, metadata)
    expect(missing.status).not.toBe(0)
    expect(missing.stderr).toContain("registry checksum")
  }
})
