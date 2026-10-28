/** Rebuild the pinned upstream distribution in a fresh caller-owned scratch directory.
 * Invoke through the declared hh flake: nix develop <code-checkout> --command bun <this-file> <scratch-parent>
 * Nothing in the committed distribution is overwritten by this command.
 */
import { createHash } from "node:crypto"
import { mkdtemp, mkdir } from "node:fs/promises"
import { isAbsolute, join } from "node:path"

const home = import.meta.dirname
const receipt = (await Bun.file(join(home, "RECEIPT.json")).json()) as {
  toolchain: { bun: string; zig: string; nixAttribute: string }
  web: { commit: string; archiveSha256: string }
  core: { commit: string; archiveSha256: string }
  patchSha256: string
  innerPatchSha256: string
  upstreamLockSha256: string
  outputs: Record<string, string>
}
const parent = process.argv[2]
if (!parent || !isAbsolute(parent)) throw new Error("rebuild.ts requires an absolute existing scratch-parent directory")
const work = await mkdtemp(join(parent, "ghostty-rebuild-"))
const web = join(work, "web")
const ceiling = { ...process.env, GIT_CEILING_DIRECTORIES: work }
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
async function run(argv: string[], cwd: string, appliedFiles?: number): Promise<string> {
  const child = Bun.spawn(argv, { cwd, env: ceiling, stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  process.stdout.write(out)
  process.stderr.write(err)
  if (code !== 0) throw new Error(`${argv.join(" ")} failed with exit ${code} in ${cwd}`)
  if (appliedFiles !== undefined && (err.match(/^Applied patch .+ cleanly\.$/gm) ?? []).length !== appliedFiles) {
    throw new Error(
      `git apply did not confirm all ${appliedFiles} expected files in ${cwd}; inspect its verbose output`,
    )
  }
  return out.trim()
}
if (Bun.version !== receipt.toolchain.bun) {
  throw new Error(`Build requires declared Bun ${receipt.toolchain.bun}, found ${Bun.version}`)
}
const zig = await run(["zig", "version"], work)
if (zig !== receipt.toolchain.zig) {
  throw new Error(`Build requires flake ${receipt.toolchain.nixAttribute} Zig ${receipt.toolchain.zig}, found ${zig}`)
}
async function unpack(repo: string, commit: string, expected: string, destination: string, name: string) {
  const response = await fetch(`https://codeload.github.com/${repo}/tar.gz/${commit}`)
  if (!response.ok) throw new Error(`${repo}@${commit} archive request failed: ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (sha(bytes) !== expected) throw new Error(`${repo}@${commit} source archive SHA256 differs from RECEIPT.json`)
  const archive = join(work, `${name}.tar.gz`)
  await Bun.write(archive, bytes)
  await mkdir(destination, { recursive: true })
  await run(["tar", "-xzf", archive, "--strip-components=1", "-C", destination], work)
}
await unpack("coder/ghostty-web", receipt.web.commit, receipt.web.archiveSha256, web, "web")
const core = join(web, "ghostty")
await unpack("ghostty-org/ghostty", receipt.core.commit, receipt.core.archiveSha256, core, "core")
const patch = join(home, "producer.patch")
if (sha(new Uint8Array(await Bun.file(patch).arrayBuffer())) !== receipt.patchSha256) {
  throw new Error("producer.patch differs from RECEIPT.json")
}
await run(["git", "apply", "--check", "--verbose", patch], web)
await run(["git", "apply", "--verbose", patch], web, 4)
const inner = join(web, "patches/ghostty-wasm-api.patch")
if (sha(new Uint8Array(await Bun.file(inner).arrayBuffer())) !== receipt.innerPatchSha256) {
  throw new Error("Patched inner API differs from RECEIPT.json")
}
await run(["git", "apply", "--check", "--verbose", inner], core)
await run(["git", "apply", "--verbose", inner], core, 7)
await run(["zig", "build", "lib-vt", "-Dtarget=wasm32-freestanding", "-Doptimize=ReleaseSmall", "-j2"], core)
await Bun.write(join(web, "ghostty-vt.wasm"), Bun.file(join(core, "zig-out/bin/ghostty-vt.wasm")))
if (sha(new Uint8Array(await Bun.file(join(web, "bun.lock")).arrayBuffer())) !== receipt.upstreamLockSha256) {
  throw new Error("Upstream bun.lock differs from RECEIPT.json")
}
await run(
  [process.execPath, "install", "--frozen-lockfile", "--ignore-scripts", "--cache-dir", join(work, "cache")],
  web,
)
await run([process.execPath, "run", "typecheck"], web)
await run([process.execPath, "run", "build:lib"], web)
await run([process.execPath, "run", "build:wasm-copy"], web)
for (const [path, expected] of Object.entries(receipt.outputs)) {
  const actual = sha(new Uint8Array(await Bun.file(join(web, path)).arrayBuffer()))
  if (actual !== expected) {
    throw new Error(`Rebuilt ${path} SHA256 ${actual} differs from committed ${expected}; output retained at ${web}`)
  }
}
console.log(`Rebuild matches every committed output: ${web}`)
