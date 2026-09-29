/**
 * @failure Core import or cellsToAnsi requires the optional Ghostty renderer;
 * explicit canvas comparison conceals the renderer's load failure.
 * @level l1
 * @consumer Consumers installing @termless/core without @termless/ghostty.
 * @testonly none
 */
import { describe, expect, test, vi } from "vitest"
import { createVt100Backend } from "../packages/vt100/src/index.ts"
import { captureCrossRenderer, cellsToAnsi, compareCanvas, createTerminal, parseTape } from "../src/index.ts"

const { rendererLoadError } = vi.hoisted(() => ({ rendererLoadError: new Error("renderer load rejected") }))
vi.mock("@termless/ghostty", () => {
  throw rendererLoadError
})

describe("core with an unavailable optional renderer", () => {
  test("imports and serializes cells before an explicit comparison names the failed dependency", async () => {
    const terminal = createTerminal({ backend: createVt100Backend(), cols: 12, rows: 3 })
    try {
      terminal.feed("hello")
      expect(cellsToAnsi(terminal)).toContain("hello")
      await expect(captureCrossRenderer(terminal)).rejects.toMatchObject({
        message: expect.stringContaining("@termless/ghostty"),
        cause: expect.objectContaining({ cause: rendererLoadError }),
      })
      await expect(
        compareCanvas(parseTape('Type "hello"'), {
          backends: [{ name: "vt100", backend: createVt100Backend() }],
        }),
      ).rejects.toMatchObject({
        message: expect.stringContaining("@termless/ghostty"),
        cause: expect.objectContaining({ cause: rendererLoadError }),
      })
    } finally {
      await terminal.close()
    }
  })
})
