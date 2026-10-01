/**
 * @failure Packed libvterm exports an unusable factory or carries WASM/JS bytes
 * that contradict its build receipt, so an import-only check misses failure.
 * @level l3
 * @consumer @termless/libvterm installed public API and packaged build receipt
 * @testonly none
 */
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { createLibvtermBackend, initLibvterm } from "@termless/libvterm"

const packageEntry = import.meta.resolve("@termless/libvterm")
const receipt = JSON.parse(readFileSync(new URL("../wasm/libvterm.wasm.receipt.json", packageEntry), "utf8"))
/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")
assert.equal(receipt.buildInputs.runtimeTarget, "node")
assert.equal(receipt.sha256, sha256(readFileSync(new URL("../wasm/libvterm.wasm", packageEntry))))
assert.equal(receipt.jsSha256, sha256(readFileSync(new URL("../wasm/libvterm.js", packageEntry))))

await initLibvterm()
const backend = createLibvtermBackend()
backend.init({ cols: 8, rows: 2 })
try {
  backend.feed(new TextEncoder().encode("Aé世"))
  assert.equal(backend.getText().split("\n")[0], "Aé世")
  assert.equal(backend.getCell(0, 0).char, "A")
  assert.equal(backend.getCell(0, 1).char, "é")
  assert.equal(backend.getCell(0, 2).char, "世")
} finally {
  backend.destroy()
}
