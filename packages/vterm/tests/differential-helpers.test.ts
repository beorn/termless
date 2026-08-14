import { describe, expect, test } from "vitest"

import type { Cell, CellBuffer } from "../src/silvery-compat.ts"
import { diffCells } from "./differential-helpers.ts"

function buffer(cell: Cell): CellBuffer {
  return {
    cols: 1,
    rows: 1,
    getCell: () => cell,
  }
}

function cell(hyperlink?: string): Cell {
  return {
    char: "L",
    fg: null,
    bg: null,
    attrs: {},
    hyperlink,
    wide: false,
    continuation: false,
  }
}

describe("session differential cell identity", () => {
  test("treats hyperlink metadata as observable cell state", () => {
    expect(diffCells(buffer(cell("https://example.com")), buffer(cell()))).toHaveLength(1)
  })
})
