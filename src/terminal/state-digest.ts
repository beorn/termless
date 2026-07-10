/**
 * Terminal state digest — one comparison vocabulary for "same terminal state".
 *
 * {@link terminalStateDigest} reads any {@link TerminalReadable} and returns a
 * plain, serializable snapshot of everything that defines the terminal's
 * observable state: geometry, cursor, title, modes, and the visible grid as
 * text lines plus a per-row style signature. {@link diffTerminalStates} turns
 * two such digests into a structured, human-readable difference.
 *
 * This is the engine-neutral form of the restore-equivalence oracle's ad-hoc
 * digest (cursor / active buffer / margins / attrs / modes + text): instead of
 * reaching into one emulator's snapshot internals, it reads through the shared
 * {@link TerminalReadable} contract, so the SAME "are these two terminals in the
 * same state?" assertion works across every backend and across a live terminal
 * vs. a rehydrated one.
 *
 * **Determinism (the load-bearing property).** A digest is built with a fixed
 * key order (`size`, `cursor`, `title`, `modes`, `rows`), modes are walked in
 * the fixed {@link DIGEST_MODES} order, and every leaf is a string, number,
 * boolean, or `null` — colors are flattened into the style signature, never
 * nested objects. Therefore **equal state ⇒ byte-identical `JSON.stringify`**,
 * and a digest survives a JSON round-trip unchanged. That is what makes it safe
 * for cheap deep-equality (`toEqual`), stable snapshots, and cross-process
 * comparison.
 *
 * **Granularity vs. {@link diffBuffers}.** `diffBuffers` compares two *live*
 * terminals cell-by-cell (grid only). The state digest is broader (cursor,
 * modes, title, geometry) and serializable, but row-granular for the grid — it
 * answers "same whole-terminal state?" where `diffBuffers` answers "which cells
 * moved?". They compose over the same {@link TerminalReadable} contract; neither
 * replaces the other.
 */

import type { Cell, CursorStyle, RGB, TerminalMode, TerminalReadable } from "./types.ts"

// =============================================================================
// Types
// =============================================================================

/** Options for {@link terminalStateDigest}. */
export interface TerminalStateDigestOptions {
  /**
   * Right-trim trailing blank cells from each row's `text` (default `true`).
   * Style signatures always span the full row width regardless — a trailing
   * styled-but-blank cell still registers as a difference in {@link DigestRow.style}.
   */
  trimTrailingBlanks?: boolean
}

/** The cursor, in grid vocabulary (`row`/`col`, not `x`/`y`). */
export interface DigestCursor {
  row: number
  col: number
  /** `null` when the backend doesn't track visibility. */
  visible: boolean | null
  /** `null` when the backend doesn't track cursor shape. */
  style: CursorStyle | null
}

/** One screen row: its text and a canonical signature of its cells' styles. */
export interface DigestRow {
  /** The row's characters. Right-trimmed of trailing blanks unless disabled. */
  text: string
  /**
   * Canonical, deterministic encoding of the row's per-cell style attributes,
   * run-length compressed. Two rows with identical styling produce an identical
   * signature; the text is carried separately in {@link DigestRow.text}.
   */
  style: string
}

/**
 * A plain, serializable snapshot of a terminal's observable state.
 *
 * `size` is the terminal geometry. `rows` is the visible grid (the screen), so
 * `rows.length === size.rows` for a contract-conformant backend.
 */
export interface TerminalStateDigest {
  size: { cols: number; rows: number }
  cursor: DigestCursor
  title: string
  modes: Record<TerminalMode, boolean>
  rows: DigestRow[]
}

/** One mode that differs between two digests. */
export interface ModeDiff {
  mode: TerminalMode
  a: boolean
  b: boolean
}

/** One screen row that differs between two digests (`row` = screen row index). */
export interface RowDiff {
  row: number
  a: DigestRow
  b: DigestRow
}

/**
 * Structured difference between two {@link TerminalStateDigest}s. `equal` is
 * `true` iff no field differs; the optional fields are present only for the
 * dimensions that actually diverge. `formatted` is a human-readable rendering
 * (the sentinel `"Terminal states are identical"` when equal).
 */
export interface TerminalStateDiff {
  equal: boolean
  size?: { a: TerminalStateDigest["size"]; b: TerminalStateDigest["size"] }
  cursor?: { a: DigestCursor; b: DigestCursor }
  title?: { a: string; b: string }
  modes?: ModeDiff[]
  rows?: RowDiff[]
  formatted: string
}

// =============================================================================
// Mode order — the single source of iteration order
// =============================================================================

/**
 * Canonical, fixed iteration order for {@link TerminalMode}. The digest and the
 * diff both walk this list, which is what keeps a digest's `modes` serialization
 * byte-stable. The type guard below fails the build if a mode is ever added to
 * the union without being listed here — no mode may be silently dropped from an
 * equivalence check.
 */
const DIGEST_MODES = [
  "altScreen",
  "cursorVisible",
  "bracketedPaste",
  "applicationCursor",
  "applicationKeypad",
  "autoWrap",
  "mouseTracking",
  "focusTracking",
  "originMode",
  "insertMode",
  "reverseVideo",
] as const satisfies readonly TerminalMode[]

// Compile-time completeness: `UncoveredMode` is `never` iff every TerminalMode
// is listed above. If a new mode is added to the union but not here, this line
// stops typechecking — fail loud, not a silent gap in the digest.
type UncoveredMode = Exclude<TerminalMode, (typeof DIGEST_MODES)[number]>
const _allModesCovered: UncoveredMode extends never ? true : never = true
void _allModesCovered

// =============================================================================
// Digest
// =============================================================================

/**
 * Capture a terminal's observable state as a plain, serializable digest.
 *
 * The grid captured is the **screen** (the visible live grid), derived as the
 * last `screenLines` rows of {@link TerminalReadable.getLines} — robust whether
 * or not a backend includes scrollback in `getLines()`.
 */
export function terminalStateDigest(
  term: TerminalReadable,
  opts: TerminalStateDigestOptions = {},
): TerminalStateDigest {
  const trim = opts.trimTrailingBlanks ?? true

  const scrollback = term.getScrollback()
  const screenLines = Math.max(0, scrollback.screenRows)
  const allLines = term.getRows()
  const screen = screenLines > 0 ? allLines.slice(Math.max(0, allLines.length - screenLines)) : []

  const cols = screen.reduce((max, row) => Math.max(max, row.length), 0)
  const rows = screen.map((cells) => digestRow(cells, trim))

  const cursor = term.getCursor()

  const modes = {} as Record<TerminalMode, boolean>
  for (const mode of DIGEST_MODES) modes[mode] = term.getMode(mode)

  return {
    size: { cols, rows: screenLines },
    cursor: { row: cursor.row, col: cursor.col, visible: cursor.visible, style: cursor.style },
    title: term.getTitle(),
    modes,
    rows,
  }
}

function digestRow(cells: Cell[], trim: boolean): DigestRow {
  let text = cells.map((c) => c.char || " ").join("")
  if (trim) text = text.replace(/ +$/u, "")
  return { text, style: rowStyleSignature(cells) }
}

/**
 * Run-length-encode the row's per-cell style tokens into a canonical string.
 * A fully-default row of width `n` renders as `"n:-"`; styled runs carry their
 * token, e.g. `"5:- 3:fg=#ff0000;bold 12:-"`.
 */
function rowStyleSignature(cells: Cell[]): string {
  const runs: string[] = []
  let token: string | null = null
  let len = 0
  for (const cell of cells) {
    const next = cellStyleToken(cell)
    if (next === token) {
      len++
    } else {
      if (token !== null) runs.push(`${len}:${token || "-"}`)
      token = next
      len = 1
    }
  }
  if (token !== null) runs.push(`${len}:${token || "-"}`)
  return runs.join(" ")
}

/**
 * A cell's style identity as a compact, deterministic string. Attributes are
 * emitted in a fixed order; a fully-default cell yields `""`. The character is
 * deliberately excluded — text lives in {@link DigestRow.text}.
 */
function cellStyleToken(cell: Cell): string {
  const parts: string[] = []
  if (cell.fg) parts.push(`fg=${hex(cell.fg)}`)
  if (cell.bg) parts.push(`bg=${hex(cell.bg)}`)
  if (cell.bold) parts.push("bold")
  if (cell.dim) parts.push("dim")
  if (cell.italic) parts.push("italic")
  if (cell.underline !== false) parts.push(`underline=${cell.underline}`)
  if (cell.underlineColor) parts.push(`underlineColor=${hex(cell.underlineColor)}`)
  if (cell.strikethrough) parts.push("strike")
  if (cell.inverse) parts.push("inverse")
  if (cell.blink) parts.push("blink")
  if (cell.hidden) parts.push("hidden")
  if (cell.wide) parts.push("wide")
  if (cell.continuation) parts.push("continuation")
  if (cell.hyperlink) parts.push(`link=${cell.hyperlink}`)
  return parts.join(";")
}

function hex(c: RGB): string {
  return `#${byteHex(c.r)}${byteHex(c.g)}${byteHex(c.b)}`
}

function byteHex(n: number): string {
  return Math.max(0, Math.min(255, Math.trunc(n)))
    .toString(16)
    .padStart(2, "0")
}

// =============================================================================
// Diff
// =============================================================================

const EMPTY_ROW: DigestRow = { text: "", style: "" }

/**
 * Compute the structured difference between two terminal-state digests.
 *
 * Empty diff (`equal: true`) means the two states are indistinguishable at the
 * digest's resolution. Otherwise each diverging dimension is reported, and
 * `rows` lists every differing screen row in order (the first is the row the
 * conventional "first difference" points at).
 */
export function diffTerminalStates(a: TerminalStateDigest, b: TerminalStateDigest): TerminalStateDiff {
  const diff: TerminalStateDiff = { equal: true, formatted: "" }
  const lines: string[] = []

  if (a.size.cols !== b.size.cols || a.size.rows !== b.size.rows) {
    diff.size = { a: a.size, b: b.size }
    lines.push(`size: ${a.size.cols}×${a.size.rows} vs ${b.size.cols}×${b.size.rows}`)
  }

  if (!cursorEqual(a.cursor, b.cursor)) {
    diff.cursor = { a: a.cursor, b: b.cursor }
    lines.push(`cursor: ${formatCursor(a.cursor)} vs ${formatCursor(b.cursor)}`)
  }

  if (a.title !== b.title) {
    diff.title = { a: a.title, b: b.title }
    lines.push(`title: ${JSON.stringify(a.title)} vs ${JSON.stringify(b.title)}`)
  }

  const modeDiffs: ModeDiff[] = []
  for (const mode of DIGEST_MODES) {
    if (a.modes[mode] !== b.modes[mode]) modeDiffs.push({ mode, a: a.modes[mode], b: b.modes[mode] })
  }
  if (modeDiffs.length > 0) {
    diff.modes = modeDiffs
    lines.push(`modes: ${modeDiffs.map((m) => `${m.mode} ${m.a}→${m.b}`).join(", ")}`)
  }

  const rowDiffs: RowDiff[] = []
  const maxRows = Math.max(a.rows.length, b.rows.length)
  for (let row = 0; row < maxRows; row++) {
    const ra = a.rows[row] ?? EMPTY_ROW
    const rb = b.rows[row] ?? EMPTY_ROW
    if (ra.text !== rb.text || ra.style !== rb.style) rowDiffs.push({ row, a: ra, b: rb })
  }
  if (rowDiffs.length > 0) {
    diff.rows = rowDiffs
    for (const rd of rowDiffs) {
      lines.push(`row ${rd.row}: ${JSON.stringify(rd.a.text)} vs ${JSON.stringify(rd.b.text)}`)
      if (rd.a.style !== rd.b.style) lines.push(`  style: ${rd.a.style} vs ${rd.b.style}`)
    }
  }

  diff.equal = lines.length === 0
  diff.formatted = diff.equal ? "Terminal states are identical" : lines.join("\n")
  return diff
}

function cursorEqual(a: DigestCursor, b: DigestCursor): boolean {
  return a.row === b.row && a.col === b.col && a.visible === b.visible && a.style === b.style
}

function formatCursor(c: DigestCursor): string {
  const flags = `${c.visible === false ? " hidden" : ""}${c.style ? ` ${c.style}` : ""}`
  return `(${c.row},${c.col})${flags}`
}
