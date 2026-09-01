/**
 * Tests for snapshotView() -- folding an engine-native (vterm-family) snapshot
 * into the Terminal read contract, so region selectors run over a frozen
 * snapshot the same way they run over a live backend.
 */

import { describe, test, expect } from "vitest"
import { snapshotView, type EngineSnapshot, type EngineSnapshotCell } from "../src/terminal/snapshot-view.ts"
import { createRow, createScreenView } from "../src/terminal/views.ts"

const BLANK: EngineSnapshotCell = {
  char: " ",
  fg: null,
  bg: null,
  bold: false,
  faint: false,
  italic: false,
  underline: "none",
  underlineColor: null,
  strikethrough: false,
  inverse: false,
  blink: false,
  hidden: false,
  wide: false,
  url: null,
}

function cell(char: string, overrides: Partial<EngineSnapshotCell> = {}): EngineSnapshotCell {
  return { ...BLANK, char, ...overrides }
}

function blankRow(cols: number): EngineSnapshotCell[] {
  return Array.from({ length: cols }, () => ({ ...BLANK }))
}

/** A 3-col x 2-row snapshot, one row of scrollback above it, scrolled to the bottom. */
function makeSnapshot(): EngineSnapshot {
  return {
    cols: 3,
    rows: 2,
    activeBuffer: "main",
    main: {
      grid: [[cell("H", { bold: true }), cell("i"), cell("!")], blankRow(3)],
    },
    alt: { grid: [] },
    scrollback: [[cell("S"), cell("1"), cell("2")]],
    viewportOffset: 0,
    cursor: { x: 1, y: 0, visible: true, shape: "bar" },
    modes: {
      bracketedPaste: false,
      applicationCursor: false,
      applicationKeypad: false,
      autoWrap: true,
      mouseTracking: false,
      focusTracking: false,
      origin: false,
      insert: false,
      reverseVideo: false,
    },
    title: "demo",
  }
}

describe("snapshotView", () => {
  test("region selectors over a snapshot view: screen text", () => {
    const term = snapshotView(makeSnapshot())

    // Scrollback (1 row) sits before the screen (2 rows) in absolute buffer
    // rows -- getScrollback() must place the screen view correctly, exactly
    // as it would for a live backend.
    expect(term.getScrollback()).toEqual({
      viewportTop: 1,
      totalRows: 3,
      screenRows: 2,
      viewportOffset: 1,
      totalLines: 3,
      screenLines: 2,
    })

    // The screen region selector (the same one behind `term.screen` on a live
    // TestTerminal) reads only the screen rows, not scrollback.
    const screen = createScreenView(term)
    expect(screen.getText()).toBe("Hi!\n")
    expect(screen.containsText("Hi!")).toBe(true)
    expect(screen.containsText("S12")).toBe(false)

    // The buffer includes scrollback too. getText() is the raw per-cell join
    // (no trim) -- the blank second screen row renders as three spaces.
    expect(term.getText()).toBe("S12\nHi!\n   ")

    // A row selector over the folded view.
    expect(createRow(term, 1, 0).getText()).toBe("Hi!")
  })

  test("region selectors over a snapshot view: a cell", () => {
    const term = snapshotView(makeSnapshot())

    // Absolute row 1 is the first screen row ("Hi!") -- scrollback occupies
    // absolute row 0.
    const middle = term.getCell(1, 1)
    expect(middle.char).toBe("i")
    expect(middle.bold).toBe(false)

    const first = term.getCell(1, 0)
    expect(first.char).toBe("H")
    expect(first.bold).toBe(true)
  })

  test("region selectors over a snapshot view: cursor and modes", () => {
    const term = snapshotView(makeSnapshot())

    expect(term.getCursor()).toEqual({ col: 1, row: 0, x: 1, y: 0, visible: true, style: "beam" })
    expect(term.getTitle()).toBe("demo")
    expect(term.getMode("autoWrap")).toBe(true)
    expect(term.getMode("altScreen")).toBe(false)
    expect(term.getMode("cursorVisible")).toBe(true)
  })
})
