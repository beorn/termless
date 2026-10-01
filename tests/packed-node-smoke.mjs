/**
 * @failure Packed Node consumers cannot encode/decode PNGs or compose a grid
 * when the codec resolves as a CommonJS namespace rather than an ESM module.
 * @level l3
 * @consumer @termless/core installed public API
 * @testonly none
 * Run from an isolated installed consumer with the public vt100 backend.
 */
import assert from "node:assert/strict"
import { compareTape, decodePngRgba, encodePng, parseTape } from "@termless/core"
import { createVt100Backend } from "@termless/vt100"

const pixels = new Uint8Array(16 * 16 * 4)
for (let offset = 0; offset < pixels.length; offset += 4) {
  pixels.set([32, 64, 96, 255], offset)
}
const image = decodePngRgba(encodePng({ width: 16, height: 16, data: pixels }))
assert.equal(image.width, 16)
assert.equal(image.height, 16)
assert.deepEqual(image.data, pixels)

const result = await compareTape(parseTape('Type "hi"\nScreenshot'), {
  backends: [
    { name: "left", backend: createVt100Backend() },
    { name: "right", backend: createVt100Backend() },
  ],
  mode: "grid",
})
assert.equal(result.textMatch, true)
assert.equal(result.screenshots.length, 2)
assert.ok(result.screenshots.every((frame) => frame.text.includes("hi")))
assert.match(result.composedSvg, /<svg\b/)
assert.match(result.composedSvg, /data:image\/png;base64,/)
