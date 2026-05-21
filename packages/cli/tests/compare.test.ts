import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { compareAction } from "../src/compare-cmd.ts"

describe("compare verb", () => {
  it("rejects fewer than two backends", async () => {
    const dir = mkdtempSync(join(tmpdir(), "termless-compare-"))
    try {
      const tape = join(dir, "demo.tape")
      writeFileSync(tape, 'Type "hi"\nEnter\n', "utf-8")
      await expect(compareAction(tape, { backend: "vterm" })).rejects.toThrow("at least 2 backends")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("rejects an empty backend selection", async () => {
    const dir = mkdtempSync(join(tmpdir(), "termless-compare-"))
    try {
      const tape = join(dir, "demo.tape")
      writeFileSync(tape, 'Type "hi"\n', "utf-8")
      await expect(compareAction(tape, {})).rejects.toThrow("at least 2 backends")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
