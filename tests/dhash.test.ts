import { createCanvas } from "@napi-rs/canvas"
import { describe, expect, test } from "vitest"

import { dHash, hashDistance } from "../src/compare.ts"

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
})
