/**
 * @failure Packed ghostty-native omits the addon required by its installed backend.
 * @level l3
 * @consumer @termless/ghostty-native installed public API
 * @testonly none
 */
import assert from "node:assert/strict"
import { createGhosttyNativeBackend } from "@termless/ghostty-native"

const backend = createGhosttyNativeBackend()
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
