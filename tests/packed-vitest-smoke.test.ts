import { describe, expect, test } from "vitest"

const packageSpecifier = process.env.TERMLESS_PACKED_SMOKE ? "@termless/test" : "../packages/viterm/src/index.ts"
const { createTestTerminal } = await import(packageSpecifier)

describe("@termless/test packed artifact", () => {
  test("loads inside a supported Vitest runner", () => {
    expect(createTestTerminal).toBeTypeOf("function")
  })
})
