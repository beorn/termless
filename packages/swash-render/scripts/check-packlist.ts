import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)))
const result = spawnSync(process.execPath, ["pm", "pack", "--dry-run"], {
  cwd: packageDir,
  encoding: "utf8",
})

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
if (result.status !== 0) {
  console.error(output)
  process.exit(result.status ?? 1)
}

const forbidden = [/native[\\/]target/, /\.node\b/]
const hit = forbidden.find((pattern) => pattern.test(output))
if (hit) {
  console.error(output)
  console.error(`@termless/swash-render packlist includes forbidden artifact pattern: ${hit}`)
  process.exit(1)
}

const sizeMatch = output.match(/Unpacked size:\s+([0-9.]+)([KMGT]?B)/i)
if (!sizeMatch) {
  console.error(output)
  console.error("Could not read unpacked package size from bun pm pack --dry-run output.")
  process.exit(1)
}

const value = Number(sizeMatch[1])
const unit = sizeMatch[2]!.toUpperCase()
const multiplier = unit === "KB" ? 1024 : unit === "MB" ? 1024 ** 2 : unit === "GB" ? 1024 ** 3 : 1
const bytes = value * multiplier
const maxBytes = 256 * 1024
if (bytes > maxBytes) {
  console.error(output)
  console.error(`@termless/swash-render package is too large: ${Math.round(bytes)} bytes > ${maxBytes} bytes`)
  process.exit(1)
}

console.log(`@termless/swash-render packlist OK (${join("packages", "swash-render")}, ${Math.round(bytes)} bytes)`)
