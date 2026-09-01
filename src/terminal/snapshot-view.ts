/**
 * Fold-as-Terminal — wrap an engine-native snapshot as a {@link Terminal} read
 * view, so termless's region selectors (`createRegion`/`createRow`/…, and the
 * `screen`/`scrollback`/`buffer`/`viewport` views built on them) and matchers
 * run over a frozen snapshot exactly as they run over a live backend.
 *
 * {@link EngineSnapshot} is a **structural** mirror of the shape a vterm-family
 * engine's `Screen.snapshot()` returns (concretely: `@termless/vterm`'s backend
 * reads this off `VtermScreen.snapshot()` — see its `snapshotRows()` /
 * `getScrollback()`). It is declared here by hand, field-for-field, rather than
 * imported from `vterm.js` — core takes a TYPE-ONLY, duck-typed dependency on
 * the shape, never a package dependency on the engine. Any object shaped like
 * {@link EngineSnapshot} folds, whether it came from vterm.js or elsewhere.
 *
 * This is the "fold" named in the terminal-layer plan: a Recording (or, here,
 * a point-in-time engine snapshot) folds into the {@link Terminal} read
 * contract, so selectors/matchers query a frozen moment the same way they
 * query a live seat.
 */

import type { Cell, Color, Cursor, CursorStyle, ScrollbackState, Terminal, TerminalMode } from "./types.ts"

/**
 * One cell as a vterm-family engine snapshot represents it. Field-for-field
 * match of vterm.js's `ScreenCell` (see `packages/vterm/src/backend.ts`'s
 * `convertCell`), minus the fields no engine snapshot needs for a read-only
 * fold (`overline` has no slot in termless's {@link Cell}, same as the live
 * vterm backend).
 */
export interface EngineSnapshotCell {
  char: string
  fg: Color | null
  bg: Color | null
  bold: boolean
  faint: boolean
  italic: boolean
  underline: "none" | "single" | "double" | "curly" | "dotted" | "dashed"
  underlineColor: Color | null
  strikethrough: boolean
  inverse: boolean
  blink: boolean
  hidden: boolean
  wide: boolean
  url: string | null
}

/** One screen buffer (main or alt) inside an {@link EngineSnapshot}. */
export interface EngineSnapshotBuffer {
  grid: readonly (readonly EngineSnapshotCell[])[]
}

/** Boolean terminal modes as a vterm-family engine snapshot represents them. */
export interface EngineSnapshotModes {
  bracketedPaste: boolean
  applicationCursor: boolean
  applicationKeypad: boolean
  autoWrap: boolean
  mouseTracking: boolean
  focusTracking: boolean
  origin: boolean
  insert: boolean
  reverseVideo: boolean
}

/**
 * The structural shape of a vterm-family engine's `screen.snapshot()` result,
 * narrowed to what a {@link Terminal} read view needs. Not imported from
 * vterm.js — see the module doc.
 */
export interface EngineSnapshot {
  cols: number
  rows: number
  activeBuffer: "main" | "alt"
  main: EngineSnapshotBuffer
  alt: EngineSnapshotBuffer
  scrollback: readonly (readonly EngineSnapshotCell[])[]
  /** Bottom-relative scroll offset: 0 at the live bottom, positive scrolled up into history. */
  viewportOffset: number
  cursor: {
    x: number
    y: number
    visible: boolean
    shape: "block" | "underline" | "bar"
  }
  modes: EngineSnapshotModes
  title: string
}

const BLANK_CELL: Cell = {
  char: " ",
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  underlineColor: null,
  strikethrough: false,
  inverse: false,
  blink: false,
  hidden: false,
  wide: false,
  continuation: false,
  hyperlink: null,
}

function mapCursorShape(shape: "block" | "underline" | "bar"): CursorStyle {
  return shape === "bar" ? "beam" : shape
}

function convertCell(sc: EngineSnapshotCell | undefined, prevWide: boolean): Cell {
  if (!sc) return BLANK_CELL
  const continuation = prevWide && sc.char === ""
  return {
    char: continuation ? "" : sc.char,
    fg: sc.fg,
    bg: sc.bg,
    bold: sc.bold,
    dim: sc.faint,
    italic: sc.italic,
    underline: sc.underline === "none" ? false : sc.underline,
    underlineColor: sc.underlineColor,
    strikethrough: sc.strikethrough,
    inverse: sc.inverse,
    blink: sc.blink,
    hidden: sc.hidden,
    wide: sc.wide,
    continuation,
    hyperlink: sc.url,
  }
}

function convertRow(row: readonly EngineSnapshotCell[] | undefined): Cell[] {
  const cells: Cell[] = []
  let prevWide = false
  for (const sc of row ?? []) {
    cells.push(convertCell(sc, prevWide))
    prevWide = sc.wide
  }
  return cells
}

/**
 * Wrap an {@link EngineSnapshot} as a {@link Terminal} read view.
 *
 * Structural, not nominal: any object shaped like {@link EngineSnapshot} folds
 * — including `@termless/vterm`'s `VtermScreen.snapshot()` — without core
 * taking a dependency on vterm.js. Region selectors (`createRegion`,
 * `createRow`, and the `screen`/`scrollback`/`buffer`/`viewport` views built on
 * them) accept any {@link Terminal}, so they work over the returned view the
 * same as over a live backend.
 */
export function snapshotView(snapshot: EngineSnapshot): Terminal {
  const grid = snapshot.activeBuffer === "alt" ? snapshot.alt.grid : snapshot.main.grid
  const scrollback = snapshot.scrollback
  const rows: Cell[][] = new Array(scrollback.length + grid.length)
  for (let row = 0; row < scrollback.length; row++) rows[row] = convertRow(scrollback[row])
  for (let row = 0; row < grid.length; row++) rows[scrollback.length + row] = convertRow(grid[row])

  const cellAt = (row: number, col: number): Cell => rows[row]?.[col] ?? BLANK_CELL

  return {
    getText(): string {
      return rows.map((row) => row.map((cell) => cell.char || " ").join("")).join("\n")
    },
    getTextRange(startRow: number, startCol: number, endRow: number, endCol: number): string {
      const parts: string[] = []
      for (let row = startRow; row <= endRow; row++) {
        const cells = rows[row]
        if (!cells) continue
        const start = row === startRow ? startCol : 0
        const end = row === endRow ? endCol : cells.length
        parts.push(
          cells
            .slice(start, end)
            .map((cell) => cell.char || " ")
            .join(""),
        )
      }
      return parts.join("\n")
    },
    getCell: cellAt,
    getRow: (row: number): Cell[] => rows[row] ?? [],
    getRows: (): Cell[][] => rows,
    getLine: (row: number): Cell[] => rows[row] ?? [],
    getLines: (): Cell[][] => rows,
    getCursor(): Cursor {
      const c = snapshot.cursor
      return { col: c.x, row: c.y, x: c.x, y: c.y, visible: c.visible, style: mapCursorShape(c.shape) }
    },
    getMode(mode: TerminalMode): boolean {
      const m = snapshot.modes
      switch (mode) {
        case "altScreen":
          return snapshot.activeBuffer === "alt"
        case "cursorVisible":
          return snapshot.cursor.visible
        case "bracketedPaste":
          return m.bracketedPaste
        case "applicationCursor":
          return m.applicationCursor
        case "applicationKeypad":
          return m.applicationKeypad
        case "autoWrap":
          return m.autoWrap
        case "mouseTracking":
          return m.mouseTracking
        case "focusTracking":
          return m.focusTracking
        case "originMode":
          return m.origin
        case "insertMode":
          return m.insert
        case "reverseVideo":
          return m.reverseVideo
        default:
          return false
      }
    },
    getTitle(): string {
      return snapshot.title
    },
    getScrollback(): ScrollbackState {
      const scrollbackLength = scrollback.length
      const viewportTop = scrollbackLength - snapshot.viewportOffset
      const totalRows = scrollbackLength + snapshot.rows
      return {
        viewportTop,
        totalRows,
        screenRows: snapshot.rows,
        viewportOffset: viewportTop,
        totalLines: totalRows,
        screenLines: snapshot.rows,
      }
    },
  }
}
