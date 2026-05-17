import { describe, expect, it } from "vitest"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { compareSeparateOutputDir, resolveBackendNames, writeComparisonOutput } from "../src/play-cmd.ts"

const catalog = {
  names: () => ["vterm", "ghostty", "alacritty", "vt100"],
  ready: (name: string) => name !== "alacritty",
}

describe("resolveBackendNames", () => {
  it("leaves unspecified backend selection to the player default", () => {
    expect(resolveBackendNames(undefined, catalog)).toBeUndefined()
  })

  it("parses comma-separated backend names", () => {
    expect(resolveBackendNames("vterm, ghostty", catalog)).toEqual(["vterm", "ghostty"])
  })

  it("expands all to installed ready backends", () => {
    expect(resolveBackendNames("all", catalog)).toEqual(["vterm", "ghostty", "vt100"])
  })

  it("deduplicates explicit and all-expanded backend names while preserving order", () => {
    expect(resolveBackendNames("vt100,all,vterm", catalog)).toEqual(["vt100", "vterm", "ghostty"])
  })

  it("reports a useful error when all has no ready backends", () => {
    expect(() =>
      resolveBackendNames("all", {
        names: () => ["native"],
        ready: () => false,
      }),
    ).toThrow("No installed, ready backends")
  })
})

describe("comparison output helpers", () => {
  it("treats a trailing-slash separate comparison output as a directory", () => {
    expect(compareSeparateOutputDir("./screens/")).toBe("./screens")
  })

  it("uses the parent directory when separate comparison output names a file", () => {
    expect(compareSeparateOutputDir("./comparison.svg")).toBe(".")
    expect(compareSeparateOutputDir("artifacts/comparison.svg")).toBe("artifacts")
  })

  it("rasterizes composed comparison SVG when the output extension is .png", async () => {
    const dir = mkdtempSync(join(tmpdir(), "termless-play-"))
    try {
      const output = join(dir, "comparison.png")
      await writeComparisonOutput(
        output,
        '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#ff00ff"/></svg>',
      )

      expect(readFileSync(output).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
