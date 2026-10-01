/**
 * @failure PNG consumers reject a valid default-export codec or accept a broken
 * codec shape, and importing core unnecessarily requires its optional codec.
 * @level l1
 * @consumer Public synchronous PNG encoding and decoding
 * @testonly none
 * Packed Node composition owns the runtime regression; this table covers
 * resolver shapes and the missing optional dependency that it cannot induce.
 */
import { createRequire } from "node:module"
import { afterEach, expect, test, vi } from "vitest"

const actualCodec: unknown = createRequire(import.meta.url)("upng-js")
const pixels = new Uint8Array(16 * 16 * 4)
for (let offset = 0; offset < pixels.length; offset += 4) {
  pixels.set([32, 64, 96, 255], offset)
}

afterEach(() => {
  vi.doUnmock("node:module")
  vi.resetModules()
})

test.each([
  ["namespace", actualCodec],
  ["default export", { default: actualCodec }],
])("cold synchronous encoding and decoding accept the %s shape", async (_name, shape) => {
  vi.doMock("node:module", () => ({ createRequire: () => () => shape }))
  const { encodePng, decodePngRgba } = await import("../../src/render/png-codec.ts")
  const decoded = decodePngRgba(encodePng({ width: 16, height: 16, data: pixels }))
  expect(decoded.width).toBe(16)
  expect(decoded.height).toBe(16)
  expect(decoded.data).toEqual(pixels)
})

test("an invalid codec refuses with the module shape and required functions", async () => {
  vi.doMock("node:module", () => ({ createRequire: () => () => ({ default: { decode: "broken" } }) }))
  const { encodePng } = await import("../../src/render/png-codec.ts")
  expect(() => encodePng({ width: 16, height: 16, data: pixels })).toThrow(
    /Invalid upng-js module: expected decode, encode and toRGBA8 functions; namespace keys: default; default keys: decode/,
  )
})

test("an unavailable optional codec does not prevent import and fails on use", async () => {
  vi.doMock("node:module", () => ({
    createRequire: () => () => {
      throw new Error("Cannot find module 'upng-js'")
    },
  }))
  const { encodePng } = await import("../../src/render/png-codec.ts")
  expect(() => encodePng({ width: 16, height: 16, data: pixels })).toThrow("Cannot find module 'upng-js'")
})
