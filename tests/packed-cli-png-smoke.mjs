/**
 * @failure The installed CLI cannot render a recording to a real PNG.
 * @level l3
 * @consumer @termless/cli published bin
 * @testonly none
 */
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const directory = mkdtempSync(join(tmpdir(), "termless-cli-png-"))
try {
  const packageRoot = resolve("node_modules/@termless/cli")
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"))
  assert.equal(typeof manifest.bin?.termless, "string", "installed CLI must declare its published bin")
  const recording = join(directory, "input.cast")
  const output = join(directory, "output.png")
  writeFileSync(recording, `${JSON.stringify({ version: 2, width: 8, height: 2 })}\n${JSON.stringify([0, "o", "A"])}\n`)
  const result = spawnSync(
    process.execPath,
    [resolve(packageRoot, manifest.bin.termless), "play", recording, "-b", "vterm", "-o", output],
    {
      encoding: "utf8",
      timeout: 30_000,
    },
  )
  assert.ifError(result.error)
  assert.equal(result.signal, null, `CLI terminated by ${result.signal}`)
  assert.equal(result.status, 0, `CLI PNG rendering failed:\n${result.stdout}\n${result.stderr}`)
  const png = readFileSync(output)
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], "CLI must produce a PNG")
  assert.equal(png.toString("ascii", 12, 16), "IHDR")
  assert.ok(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0, "PNG dimensions must be positive")
} finally {
  rmSync(directory, { recursive: true, force: true })
}
