import { createCanvas } from "@napi-rs/canvas"
import { describe, expect, test } from "vitest"

import { createVt100Backend } from "../packages/vt100/src/index.ts"
import { captureCrossRenderer, createTerminal, dHash, hashDistance } from "../src/index.ts"

function gradientPng(horizontal: boolean): Uint8Array {
  const canvas = createCanvas(128, 128)
  const context = canvas.getContext("2d")
  const gradient = horizontal ? context.createLinearGradient(0, 0, 128, 0) : context.createLinearGradient(0, 0, 0, 128)
  gradient.addColorStop(0, "#000")
  gradient.addColorStop(1, "#fff")
  context.fillStyle = gradient
  context.fillRect(0, 0, 128, 128)
  return new Uint8Array(canvas.toBuffer("image/png"))
}

describe("dHash", () => {
  test("distinguishes horizontal and vertical structure on every supported host", async () => {
    const horizontal = await dHash(gradientPng(true))
    const vertical = await dHash(gradientPng(false))

    expect(horizontal).not.toBe("0".repeat(16))
    expect(hashDistance(horizontal, vertical)).toBe(64)
  })

  test("captureCrossRenderer hashes the canvas without enabling peekaboo", async () => {
    const terminal = createTerminal({ backend: createVt100Backend(), cols: 20, rows: 4 })
    terminal.feed("hash me")

    try {
      const result = await captureCrossRenderer(terminal, {})

      expect(result.report).toMatchObject({
        hashes: {
          canvas: expect.stringMatching(/^[0-9a-f]{16}$/),
          peekaboo: null,
        },
        hashDistances: { canvasVsPeekaboo: null },
      })
    } finally {
      await terminal.close()
    }
  })
})
