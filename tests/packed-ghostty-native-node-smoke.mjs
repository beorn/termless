/**
 * @failure A packed native backend omits its addon or retains build-host library paths.
 * @level l3
 * @consumer Installed native backend public APIs
 * @testonly none
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const factories = {
  "@termless/alacritty": "createAlacrittyBackend",
  "@termless/wezterm": "createWeztermBackend",
  "@termless/vt100-rust": "createVt100RustBackend",
  "@termless/ghostty-native": "createGhosttyNativeBackend",
}
const packageName = process.argv[2]
assert.ok(Object.hasOwn(factories, packageName), `expected a native package argument, received ${packageName}`)
assert.equal(process.platform, "linux", "this check qualifies Linux x64 glibc prebuilds only")
assert.equal(process.arch, "x64", "this check qualifies Linux x64 glibc prebuilds only")
assert.ok(process.report.getReport().header.glibcVersionRuntime, "this check requires glibc")

const addonName =
  packageName === "@termless/alacritty"
    ? "termless-alacritty-native.node"
    : `termless-${packageName.slice("@termless/".length)}.node`
const addonPath = fileURLToPath(new URL(`../${addonName}`, import.meta.resolve(packageName)))
const elf = readFileSync(addonPath)
assert.deepEqual([...elf.subarray(0, 6)], [0x7f, 0x45, 0x4c, 0x46, 2, 1], `${addonPath}: expected ELF64 little-endian`)
// Inspect the installed bytes, without relying on tools or paths from the build host.
const integer64 = (offset) => {
  const value = elf.readBigUInt64LE(offset)
  assert.ok(value <= BigInt(Number.MAX_SAFE_INTEGER), `${addonPath}: ELF integer exceeds safe range`)
  return Number(value)
}
const headers = []
const headerStart = integer64(32)
const headerSize = elf.readUInt16LE(54)
assert.ok(headerSize >= 56, `${addonPath}: truncated ELF program header`)
for (let index = 0; index < elf.readUInt16LE(56); index++) {
  const offset = headerStart + index * headerSize
  const header = {
    type: elf.readUInt32LE(offset),
    offset: integer64(offset + 8),
    address: integer64(offset + 16),
    size: integer64(offset + 32),
  }
  assert.ok(header.offset + header.size <= elf.length, `${addonPath}: program segment exceeds file`)
  headers.push(header)
}
const dynamic = headers.find((header) => header.type === 2)
assert.ok(dynamic, `${addonPath}: missing ELF dynamic section`)
const tags = new Map()
for (let offset = dynamic.offset; offset + 16 <= dynamic.offset + dynamic.size; offset += 16) {
  const tag = integer64(offset)
  if (tag === 0) break
  tags.set(tag, integer64(offset + 8))
}
for (const [tag, label] of [
  [15, "RPATH"],
  [29, "RUNPATH"],
]) {
  if (!tags.has(tag)) continue
  const address = tags.get(5)
  const segment = headers.find(
    (header) => header.type === 1 && address >= header.address && address < header.address + header.size,
  )
  assert.ok(segment, `${addonPath}: dynamic string table is outside file segments`)
  const offset = segment.offset + address - segment.address + tags.get(tag)
  const end = elf.indexOf(0, offset)
  assert.ok(offset >= 0 && end >= offset && end < segment.offset + segment.size, `${addonPath}: malformed ${label}`)
  assert.fail(`${packageName}: installed ${addonName} retains ${label}=${elf.toString("utf8", offset, end)}`)
}

const { [factories[packageName]]: createBackend } = await import(packageName)
assert.equal(typeof createBackend, "function", `${packageName}: missing public factory`)
const backend = createBackend()
backend.init({ cols: 8, rows: 2 })
try {
  backend.feed(new TextEncoder().encode("Aé世"))
  assert.equal(backend.getText().split("\n")[0]?.trimEnd(), "Aé世")
  assert.equal(backend.getCell(0, 0).char, "A")
  assert.equal(backend.getCell(0, 1).char, "é")
  assert.equal(backend.getCell(0, 2).char, "世")
} finally {
  backend.destroy()
}
