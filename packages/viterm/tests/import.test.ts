import { describe, expect, test } from "vitest"
import { spawnSync } from "node:child_process"

describe("@termless/test package import", () => {
  test("does not require an active Vitest suite", () => {
    const env = { ...process.env }
    delete env.VITEST
    delete env.VITEST_MODE

    const result = spawnSync("bun", ["--eval", 'await import("./packages/viterm/src/fixture.ts")'], {
      cwd: process.cwd(),
      encoding: "utf8",
      env,
    })

    expect(result.stderr).toBe("")
    expect(result.status).toBe(0)
  })
})
