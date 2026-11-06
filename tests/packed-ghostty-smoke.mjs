/**
 * @failure Packed @termless/ghostty cannot resolve bundled fonts from its peer
 * @termless/core, emitting missing-font warnings and throwing RangeError on
 * zero-width canvas rendering, or silently loads public Ghostty engine bytes
 * instead of its receipted private producer.
 * @level l3
 * @consumer @termless/ghostty installed public API
 * @testonly none
 */
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const wasmPath = createRequire(import.meta.resolve("@termless/ghostty")).resolve("ghostty-web/ghostty-vt.wasm")
const receipt = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.resolve("@termless/ghostty"))), "ghostty-web-RECEIPT.json"),
    "utf8",
  ),
)
assert.equal(
  createHash("sha256").update(readFileSync(wasmPath)).digest("hex"),
  receipt.outputs["ghostty-vt.wasm"],
  "packed @termless/ghostty must load its receipted private engine",
)

const { renderAnsiPng } = await import("@termless/ghostty")

const warnings = []
const originalWarn = console.warn
console.warn = (...args) => {
  warnings.push(args.join(" "))
  originalWarn(...args)
}

try {
  // Exercise the primary font, symbols, and emoji in ANSI bytes
  const ansi = "\x1b[32m[test]\x1b[0m 📁 Project: ✔ \x1b[1mBold Text\x1b[0m"
  const png = await renderAnsiPng(ansi, {
    cols: 80,
    rows: 24,
  })

  assert.ok(png instanceof Uint8Array, "renderAnsiPng must return Uint8Array")
  assert.ok(png.length > 0, "renderAnsiPng must return non-empty PNG bytes")

  // Verify PNG signature (magic bytes: 0x89 'P' 'N' 'G' \r \n 0x1a \n)
  assert.deepEqual(
    Array.from(png.subarray(0, 8)),
    [137, 80, 78, 71, 13, 10, 26, 10],
    "renderAnsiPng output must start with valid PNG header signature",
  )

  // Verify that no bundled fonts were reported missing
  const fontWarnings = warnings.filter((w) => w.includes("[termless/ghostty] bundled font missing"))
  assert.equal(
    fontWarnings.length,
    0,
    `renderAnsiPng must resolve all bundled fonts without warnings; saw: ${fontWarnings.join("; ")}`,
  )
} finally {
  console.warn = originalWarn
}
