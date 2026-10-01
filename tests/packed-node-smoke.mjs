/**
 * @failure Packed Node consumers cannot encode/decode PNGs or compose a grid
 * when the codec resolves as a CommonJS namespace rather than an ESM module.
 * @level l3
 * @consumer @termless/core installed public API
 * @testonly none
 * Run from an isolated consumer containing only the installed core package.
 */
import assert from "node:assert/strict"
import { compareTape, decodePngRgba, encodePng, parseTape } from "@termless/core"

// A caller-supplied printable-text fixture exercises the real core renderer.
// It deliberately does not emulate terminal protocols or supply screenshots.
/** @returns {import("@termless/core").TerminalBackend} */
function createFixtureBackend() {
  let cols = 16
  let rows = 16
  let column = 0
  let grid = Array.from({ length: rows }, () => Array(cols).fill(" "))
  /** @param {number} row @param {number} col @returns {import("@termless/core").Cell} */
  const getCell = (row, col) => {
    assert.ok(row >= 0 && row < rows && col >= 0 && col < cols)
    return {
      char: grid[row][col],
      fg: null,
      bg: null,
      bold: false,
      dim: false,
      italic: false,
      underline: "none",
      underlineColor: null,
      strikethrough: false,
      inverse: false,
      blink: false,
      hidden: false,
      wide: false,
      continuation: false,
      hyperlink: null,
    }
  }
  /** @param {number} row */
  const getRow = (row) => Array.from({ length: cols }, (_, col) => getCell(row, col))
  const getRows = () => Array.from({ length: rows }, (_, row) => getRow(row))
  /** @param {number} width @param {number} height */
  const resize = (width, height) => {
    cols = width
    rows = height
    column = 0
    grid = Array.from({ length: rows }, () => Array(cols).fill(" "))
  }
  return {
    name: "packed-core-fixture",
    init: ({ cols, rows }) => resize(cols, rows),
    destroy: () => {
      grid = []
    },
    feed(data) {
      for (const char of new TextDecoder().decode(data)) {
        assert.match(char, /^[ -~]$/, "fixture accepts printable ASCII only")
        assert.ok(column < cols, "fixture text must fit on its first row")
        grid[0][column++] = char
      }
    },
    resize,
    reset: () => resize(cols, rows),
    encodeKey: () => {
      throw new Error("fixture does not encode keys")
    },
    scrollViewport(delta) {
      assert.equal(delta, 0, "fixture has no scrollback")
    },
    getText: () => grid.map((row) => row.join("")).join("\n"),
    getTextRange(startRow, startCol, endRow, endCol) {
      return grid
        .slice(startRow, endRow + 1)
        .map((row, index, range) =>
          row.slice(index === 0 ? startCol : 0, index === range.length - 1 ? endCol : cols).join(""),
        )
        .join("\n")
    },
    getCell,
    getRow,
    getRows,
    getLine: getRow,
    getLines: getRows,
    getCursor: () => ({ col: column, row: 0, x: column, y: 0, visible: true, style: "block" }),
    getMode: (mode) => mode === "cursorVisible",
    getTitle: () => "",
    getScrollback: () => ({
      viewportTop: 0,
      totalRows: rows,
      screenRows: rows,
      viewportOffset: 0,
      totalLines: rows,
      screenLines: rows,
    }),
    capabilities: {
      name: "packed-core-fixture",
      version: "1.0.0",
      truecolor: false,
      kittyKeyboard: false,
      kittyGraphics: false,
      sixel: false,
      osc8Hyperlinks: false,
      semanticPrompts: false,
      unicode: "ASCII",
      reflow: false,
      extensions: new Set(),
    },
  }
}

const pixels = new Uint8Array(16 * 16 * 4)
for (let offset = 0; offset < pixels.length; offset += 4) {
  pixels.set([32, 64, 96, 255], offset)
}
const image = decodePngRgba(encodePng({ width: 16, height: 16, data: pixels }))
assert.equal(image.width, 16)
assert.equal(image.height, 16)
assert.deepEqual(image.data, pixels)

const result = await compareTape(parseTape('Type "hi"\nScreenshot'), {
  backends: [
    { name: "left", backend: createFixtureBackend() },
    { name: "right", backend: createFixtureBackend() },
  ],
  executorOptions: { cols: 16, rows: 16 },
  mode: "grid",
})
assert.equal(result.textMatch, true)
assert.equal(result.screenshots.length, 2)
assert.ok(result.screenshots.every((frame) => frame.text.includes("hi")))
assert.match(result.composedSvg, /<svg\b/)
assert.match(result.composedSvg, /data:image\/png;base64,/)
