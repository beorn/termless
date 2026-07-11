import { describe, expect, test } from "vitest"
import { bufferFromRows, cloneBufferRows, mergeDirtyRows, type BufferLike } from "../src/terminal/dirty-plane.ts"

function makeBuffer(rows: string[]): BufferLike<string> {
  return bufferFromRows(rows.map((row) => row.split("")))
}

describe("dirty-plane helpers", () => {
  test("mergeDirtyRows patches only the dirty rectangle", () => {
    const current = makeBuffer(["abc", "def", "ghi"])
    const next = makeBuffer(["ABC", "Dxf", "GHI"])
    const merged = mergeDirtyRows(cloneBufferRows(current), next, [{ row: 1, col: 1, width: 1, height: 1 }])

    expect(merged.map((row) => row.join(""))).toEqual(["abc", "dxf", "ghi"])
  })

  test("mergeDirtyRows falls back to cloning when geometry changes", () => {
    const current = makeBuffer(["abc", "def"])
    const next = makeBuffer(["ABC", "DEF", "GHI"])
    const merged = mergeDirtyRows(cloneBufferRows(current), next, [{ row: 0, col: 0, width: 3, height: 3 }])

    expect(merged.map((row) => row.join(""))).toEqual(["ABC", "DEF", "GHI"])
  })
})
