/**
 * Region views over the io Emulator — the picture path of `terminal/views.ts`.
 *
 * The legacy Terminal path is exercised by tests/terminal.test.ts; here the
 * same factories read an Emulator, and one test pins that both readers paint
 * the same text from the same backend, which is what makes them one
 * implementation rather than two.
 */

import { describe, expect, test } from "vitest"
import { createXtermBackend } from "../../packages/xtermjs/src/backend.ts"
import { micros } from "../../src/io/index.ts"
import { emulatorFromBackend } from "../../src/terminal/io-compat.ts"
import {
  createBufferView,
  createRangeView,
  createRow,
  createScreenView,
  createScrollbackView,
  createViewportView,
} from "../../src/terminal/views.ts"
import { bytes } from "./fixtures.ts"

const SIZE = { cols: 20, rows: 4 }

/** A backend-backed Emulator with `lines` numbered lines printed into it. */
function picture(lines: number) {
  const backend = createXtermBackend()
  backend.init({ cols: SIZE.cols, rows: SIZE.rows })
  const emulator = emulatorFromBackend(backend, SIZE)
  const text = Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join("\r\n")
  emulator.apply({ at: micros(0), type: "output", data: bytes(text) })
  return { backend, emulator }
}

describe("views over the io Emulator", () => {
  test("the scrollback extent splits the buffer into history and screen", () => {
    const { backend, emulator } = picture(10)
    try {
      expect(emulator.scrollback).toBe(6)
      expect(createScreenView(emulator).getLines()).toEqual(["line 7", "line 8", "line 9", "line 10"])
      expect(createScrollbackView(emulator).getLines()).toEqual([
        "line 1",
        "line 2",
        "line 3",
        "line 4",
        "line 5",
        "line 6",
      ])
      expect(createScrollbackView(emulator, 2).getLines()).toEqual(["line 5", "line 6"])
      expect(createBufferView(emulator).getText()).toBe(emulator.getText())
      expect(createScreenView(emulator).containsText("line 9")).toBe(true)
      expect(createScreenView(emulator).containsText("line 2")).toBe(false)
    } finally {
      backend.destroy()
    }
  })

  test("with no history the screen is the whole buffer", () => {
    const { backend, emulator } = picture(2)
    try {
      expect(emulator.scrollback).toBe(0)
      expect(createScrollbackView(emulator).getLines()).toEqual([])
      expect(createScreenView(emulator).getLines()).toEqual(["line 1", "line 2", "", ""])
    } finally {
      backend.destroy()
    }
  })

  test("an Emulator has no scroll position: the viewport is the screen", () => {
    const { backend, emulator } = picture(10)
    try {
      expect(createViewportView(emulator).getText()).toBe(createScreenView(emulator).getText())
    } finally {
      backend.destroy()
    }
  })

  test("row and range views read cells by absolute row", () => {
    const { backend, emulator } = picture(10)
    try {
      const row = createRow(emulator, emulator.scrollback + 1, 1)
      expect(row.row).toBe(1)
      expect(row.getText()).toBe("line 8")
      expect(row.getLines()).toEqual(["line 8"])
      expect(row.cells).toHaveLength(SIZE.cols)
      expect(row.cellAt(5)).toMatchObject({ char: "8", row: 1, col: 5 })
      expect(createRangeView(emulator, 0, 0, 0, 4).getText()).toBe("line")
      expect(createRangeView(emulator, 0, 5, 1, 4).getText()).toBe("7\nline")
      expect(createRangeView(emulator, 0, 5, 1, 4).getLines()).toEqual(["7", "line"])
    } finally {
      backend.destroy()
    }
  })

  test("the alternate screen keeps no history", () => {
    const { backend, emulator } = picture(10)
    try {
      emulator.apply({ at: micros(1), type: "output", data: bytes("\x1b[?1049h") })
      expect(emulator.scrollback).toBe(0)
      expect(createScrollbackView(emulator).getLines()).toEqual([])
    } finally {
      backend.destroy()
    }
  })

  test("one implementation, two readers: the legacy Terminal path paints the same text", () => {
    const { backend, emulator } = picture(10)
    try {
      expect(createScreenView(emulator).getText()).toBe(createScreenView(backend).getText())
      expect(createScrollbackView(emulator).getText()).toBe(createScrollbackView(backend).getText())
      expect(createScrollbackView(emulator, 3).getText()).toBe(createScrollbackView(backend, 3).getText())
      expect(createBufferView(emulator).getText()).toBe(createBufferView(backend).getText())
      expect(createViewportView(emulator).getText()).toBe(createViewportView(backend).getText())
      expect(createRangeView(emulator, 0, 5, 1, 4).getText()).toBe(createRangeView(backend, 0, 5, 1, 4).getText())
      const abs = emulator.scrollback + 2
      expect(createRow(emulator, abs, 2).getText()).toBe(createRow(backend, abs, 2).getText())
      expect(createRow(emulator, abs, 2).cellAt(3)).toEqual(createRow(backend, abs, 2).cellAt(3))
    } finally {
      backend.destroy()
    }
  })
})
