#!/usr/bin/env bun
// Converts libvterm's `t/*.test` DSL into corpus schema-v1 cases.
//
// Deterministic: `fetch.ts && extract.ts` must reproduce the checked-in tree
// byte-identically. Standalone (node:* only), per the corpus contract.
//
// ---------------------------------------------------------------------------
// The upstream DSL, and why only part of it is portable
// ---------------------------------------------------------------------------
//
// A libvterm test file is a flat script. Unindented words are DIRECTIVES that
// drive the terminal; indented lines are ASSERTIONS about what happened:
//
//     RESIZE 5,10                 <- file-level default size (before any case)
//     !Resize wider reflows       <- case name
//     RESET
//     PUSH "A"x12                 <- feed bytes ("..."xN repeats)
//       ?screen_row 0 = "AAAA"    <- QUERY: portable, asserts screen STATE
//       ?lineinfo 1 = cont        <- QUERY: no schema equivalent
//       putglyph 0x41 1 0,0       <- CALLBACK TRACE: libvterm-internal event
//
// Only `?` queries about screen state convert. The unindented-vs-indented
// distinction is NOT the portability line — callback traces are indented too.
// The line is the leading `?`, and even then only for the state kinds schema
// v1 can express.
//
// Callback traces (putglyph/damage/scrollrect/sb_pushline/output/…) assert
// libvterm's internal event granularity — which callback fired, with what
// rectangle. That is an implementation contract of one C library, not
// terminal behavior any other engine is obliged to reproduce, so translating
// them would manufacture failures that mean nothing about conformance.
//
// ---------------------------------------------------------------------------
// What is deliberately NOT converted (each is counted in COVERAGE.md)
// ---------------------------------------------------------------------------
//
// - Input-generating directives (MOUSEBTN/MOUSEMOVE/INCHAR/INKEY/ENCIN/PASTE/
//   FOCUS/SELECTION): these assert bytes the terminal sends BACK upstream, via
//   `output` traces. Schema v1 has no `expectedOutput`.
// - `?pen`, `?lineinfo`, `?screen_eol`, `?screen_attrs_extent`, `?screen_text`:
//   no schema-v1 equivalent (pen is current-pen state, not a cell; lineinfo is
//   the soft-wrap continuation flag).
// - Non-ASCII `?screen_row`/`?screen_chars`: a wide glyph occupies two cells,
//   so character index != column index and a naive conversion would emit
//   expectations that are wrong-but-plausible. Unicode coverage is kept via
//   `?screen_cell`, which is explicitly per-cell. Correctness beats case count.
// - Multi-codepoint `?screen_cell` (combining marks): schema `text` is one
//   string compared against `cell.char`, and how an engine folds combiners
//   into a cell is not settled here.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs"
import { Buffer } from "node:buffer"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { SOURCE_FILES } from "./source-files.ts"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const LICENSE = "MIT"

/**
 * Read a capture group that the regex guarantees matched. Throwing beats a
 * non-null assertion here: if a future upstream refresh changes the DSL, this
 * says which pattern stopped matching instead of quietly yielding `undefined`
 * and converting a case built on a hole.
 */
function group(m: RegExpExecArray, index: number): string {
  const value = m[index]
  if (value === undefined) throw new Error(`regex group ${index} missing in ${JSON.stringify(m[0])}`)
  return value
}

/** First element of a non-empty split; "" when the line is blank. */
function head(line: string): string {
  return line.split(/[ ,]/)[0] ?? ""
}

/**
 * libvterm cell attribute letters, from harness.c's cell printer:
 *   if(bold) "B"; if(underline) "U%d"; if(italic) "I"; if(blink) "K";
 *   if(reverse) "R"; if(font) "F%d"; if(small) "S"; if(baseline) "^" | "_"
 * Only the four with a schema CELL_ATTRS equivalent are mapped; the rest are
 * counted as dropped rather than guessed at.
 */
const ATTR_MAP: Record<string, string> = { B: "bold", I: "italic", U: "underline", R: "inverse" }

/** Harness configuration that does not change screen state — safe to ignore. */
const IGNORED_DIRECTIVES = new Set([
  "INIT",
  "WANTSTATE",
  "WANTSCREEN",
  "WANTPARSER",
  "WANTENCODING",
  "UTF8",
  "DAMAGEFLUSH",
  "DAMAGEMERGE",
  "SETDEFAULTCOL",
])

/** Directives whose behavior schema v1 cannot express — the case is rejected. */
const REJECTING_DIRECTIVES: Record<string, string> = {
  MOUSEBTN: "input directive (asserts bytes sent upstream; no expectedOutput)",
  MOUSEMOVE: "input directive (asserts bytes sent upstream; no expectedOutput)",
  INCHAR: "input directive (asserts bytes sent upstream; no expectedOutput)",
  INKEY: "input directive (asserts bytes sent upstream; no expectedOutput)",
  ENCIN: "input directive (asserts bytes sent upstream; no expectedOutput)",
  PASTE: "input directive (asserts bytes sent upstream; no expectedOutput)",
  FOCUS: "input directive (asserts bytes sent upstream; no expectedOutput)",
  SELECTION: "selection directive (no schema equivalent)",
}

interface CellExpectation {
  row: number
  col: number
  text?: string
  attrs?: string[]
}
interface Expectations {
  expectedCursor?: { row: number; col: number }
  expectedCells?: CellExpectation[]
}
interface RawRecord {
  name: string
  sourceLine: number
  cols: number
  rows: number
  license: string
  lines: string[]
}

const stats = {
  blocks: 0,
  converted: 0,
  rejected: new Map<string, number>(),
  droppedAssertions: new Map<string, number>(),
  attrsPartial: 0,
  phantomNormalized: 0,
}

const bump = (m: Map<string, number>, k: string): void => {
  m.set(k, (m.get(k) ?? 0) + 1)
}

/**
 * C-style escapes used by the DSL's PUSH strings, decoded BYTE-WISE and then
 * interpreted as UTF-8.
 *
 * The two-step matters. Upstream writes wide and accented glyphs as raw byte
 * escapes (`\xC3\x81` for `Á`), and the runner feeds a case by doing
 * `new TextEncoder().encode(input)`. Building the JS string char-by-char would
 * put U+00C3 U+0081 in it, which re-encodes to FOUR bytes — classic mojibake,
 * and it showed up as `Á` arriving at the engine as `Ã`. Collect the bytes the
 * escape actually names, then decode once, so the runner's re-encode is a
 * round trip.
 */
function unescape(raw: string): string {
  const bytes: number[] = []
  const pushUtf8 = (ch: string): void => {
    for (const b of Buffer.from(ch, "utf8")) bytes.push(b)
  }
  for (let i = 0; i < raw.length; i++) {
    if (raw.charAt(i) !== "\\") {
      pushUtf8(raw.charAt(i))
      continue
    }
    const c = raw.charAt(++i)
    if (c === "e") bytes.push(0x1b)
    else if (c === "n") bytes.push(0x0a)
    else if (c === "r") bytes.push(0x0d)
    else if (c === "t") bytes.push(0x09)
    else if (c === "a") bytes.push(0x07)
    else if (c === "b") bytes.push(0x08)
    else if (c === "f") bytes.push(0x0c)
    else if (c === "v") bytes.push(0x0b)
    else if (c === "x") {
      bytes.push(Number.parseInt(raw.slice(i + 1, i + 3), 16))
      i += 2
    } else pushUtf8(c)
  }
  return Buffer.from(bytes).toString("utf8")
}

const PUSH_RE = /^PUSH\s+"((?:[^"\\]|\\.)*)"(?:x(\d+))?/
const REP_RE = /^\$REP\s+(\d+):\s*PUSH\s+"((?:[^"\\]|\\.)*)"(?:x(\d+))?/
const SEQ_RE = /^\$SEQ\s+(-?\d+)\s+(-?\d+):\s*PUSH\s+"((?:[^"\\]|\\.)*)"/

/** Returns the bytes a PUSH-bearing directive line feeds, or null if not one. */
function pushTextOf(line: string): string | null {
  const seq = SEQ_RE.exec(line)
  if (seq !== null) {
    let out = ""
    for (let n = Number(group(seq, 1)); n <= Number(group(seq, 2)); n++) {
      out += unescape(group(seq, 3).replaceAll("\\#", String(n)))
    }
    return out
  }
  const rep = REP_RE.exec(line)
  if (rep !== null) return unescape(group(rep, 2)).repeat(Number(rep[3] ?? 1) * Number(group(rep, 1)))
  const push = PUSH_RE.exec(line)
  if (push !== null) return unescape(group(push, 1)).repeat(Number(push[2] ?? 1))
  return null
}

/** `putglyph 0x41 1 0,79` — codepoint, width, row, col. */
const PUTGLYPH_RE = /^putglyph\s+0x[0-9a-fA-F]+\s+(\d+)\s+(\d+),(\d+)/

/** DECAWM toggles anywhere in a chunk of fed bytes; the last one wins. */
function trackAutoWrap(input: string, current: boolean): boolean {
  let state = current
  for (const m of input.matchAll(/\x1b\[\?7([lh])/g)) state = m[1] === "h"
  return state
}

const ASCII_RE = /^[\x20-\x7e]*$/
const CURSOR_RE = /^\?cursor\s*=\s*(\d+),(\d+)/
const ROW_RE = /^\?screen_row\s+(\d+)\s*=\s*(.*)$/
const CHARS_RE = /^\?screen_chars\s+(\d+),(\d+),(\d+),(\d+)\s*=\s*(.*)$/
const CELL_RE = /^\?screen_cell\s+(\d+),\s*(\d+)\s*=\s*\{([^}]*)\}\s*width=(\d+)\s*attrs=\{([^}]*)\}/

/** Quoted RHS of a screen query, or null when the RHS is not a plain string. */
function quotedRhs(rhs: string): string | null {
  const trimmed = rhs.trim()
  if (trimmed.length === 0) return ""
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(trimmed)
  return m === null ? null : unescape(group(m, 1))
}

function textToCells(row: number, startCol: number, text: string, cols: number): CellExpectation[] {
  const cells: CellExpectation[] = []
  for (let i = 0; i < text.length; i++) cells.push({ row, col: startCol + i, text: text.charAt(i) })
  // libvterm's row/chars queries return the row with trailing blanks stripped,
  // so the text also asserts where the content ENDS. Pin that one blank cell;
  // without it "AB" would pass against a row reading "ABC".
  const end = startCol + text.length
  if (end < cols) cells.push({ row, col: end, text: " " })
  return cells
}

function decodeAttrs(codes: string): { attrs: string[]; dropped: boolean } {
  const attrs: string[] = []
  let dropped = false
  for (let i = 0; i < codes.length; i++) {
    const c = codes.charAt(i)
    const mapped = ATTR_MAP[c]
    if (mapped === undefined) {
      dropped = true
      continue
    }
    // U<n>/F<n> carry a numeric argument; U0 means "no underline".
    if (c === "U") {
      const digits = /^\d+/.exec(codes.slice(i + 1))?.[0] ?? ""
      i += digits.length
      if (digits === "0") continue
    }
    attrs.push(mapped)
  }
  return { attrs, dropped }
}

/**
 * Terminal facts the cursor rule needs, tracked from the DSL as we walk a block.
 */
interface QueryContext {
  cols: number
  /** DECAWM, toggled by `\e[?7l` / `\e[?7h` in the input stream. */
  autoWrap: boolean
  /** Last glyph libvterm reported placing, and the column it ends on. */
  lastGlyph: { row: number; endCol: number } | null
}

/**
 * RULING (operator, 2026-09-01): vterm KEEPS its deferred-wrap convention;
 * this is normalized converter-side instead.
 *
 * When a glyph lands on the final column with autowrap on, the terminal owes a
 * wrap it has not performed yet. libvterm represents that as "cursor still ON
 * the last column, plus a pending-wrap flag"; vterm, xterm.js and vt100 all
 * represent it as "cursor at col == cols", one past the end. ghostty sits with
 * libvterm. Neither is wrong — but our snapshot codec, hab attach and every
 * downstream consumer read OUR representation, so the corpus adapts to us.
 *
 * The rule is deliberately narrow, and only fires where the DSL PROVES the
 * phantom: libvterm must have reported a glyph ending on the last column of
 * the same row, and autowrap must be on. `!DEC Auto Wrap Mode` is exactly why
 * the autowrap guard exists — it also ends a glyph on the last column, but
 * with DECAWM off there is no pending wrap, the cursor genuinely belongs on
 * the last column, and normalizing it would MASK a real divergence rather than
 * translate a representation.
 *
 * Where the phantom cannot be proven (files whose harness config emits no
 * `putglyph` traces, e.g. 11state_movecursor), nothing is normalized and the
 * case stays ledgered. Silence beats a confident guess.
 */
function normalizeDeferredWrapCursor(row: number, col: number, ctx: QueryContext): number {
  if (col !== ctx.cols - 1 || !ctx.autoWrap) return col
  const glyph = ctx.lastGlyph
  if (glyph === null || glyph.row !== row || glyph.endCol !== ctx.cols - 1) return col
  stats.phantomNormalized++
  return ctx.cols
}

/** Merge one `?` query into the accumulating expectations; false if unusable. */
function applyQuery(line: string, exp: Expectations, ctx: QueryContext): boolean {
  const cols = ctx.cols
  const cursor = CURSOR_RE.exec(line)
  if (cursor !== null) {
    const row = Number(group(cursor, 1))
    exp.expectedCursor = { row, col: normalizeDeferredWrapCursor(row, Number(group(cursor, 2)), ctx) }
    return true
  }

  const row = ROW_RE.exec(line)
  if (row !== null) {
    const text = quotedRhs(group(row, 2))
    if (text === null) return false
    if (!ASCII_RE.test(text)) {
      bump(stats.droppedAssertions, "screen_row (non-ASCII: wide glyphs break col indexing)")
      return false
    }
    const at = Number(group(row, 1))
    const cells = text.length === 0 ? [{ row: at, col: 0, text: " " }] : textToCells(at, 0, text, cols)
    exp.expectedCells = [...(exp.expectedCells ?? []), ...cells]
    return true
  }

  const chars = CHARS_RE.exec(line)
  if (chars !== null) {
    const [r0, c0, r1] = [Number(group(chars, 1)), Number(group(chars, 2)), Number(group(chars, 3))]
    const text = quotedRhs(group(chars, 5))
    if (text === null) return false
    if (r1 !== r0 + 1) {
      bump(stats.droppedAssertions, "screen_chars (multi-row rect)")
      return false
    }
    if (!ASCII_RE.test(text)) {
      bump(stats.droppedAssertions, "screen_chars (non-ASCII: wide glyphs break col indexing)")
      return false
    }
    if (text.length === 0) return false
    exp.expectedCells = [...(exp.expectedCells ?? []), ...textToCells(r0, c0, text, cols).slice(0, text.length)]
    return true
  }

  const cell = CELL_RE.exec(line)
  if (cell !== null) {
    const hexes = group(cell, 3)
      .split(",")
      .map((h) => h.trim())
      .filter((h) => h.length > 0)
    if (hexes.length !== 1) {
      bump(stats.droppedAssertions, "screen_cell (multi-codepoint / combining)")
      return false
    }
    const { attrs, dropped } = decodeAttrs(group(cell, 5))
    if (dropped) stats.attrsPartial++
    const entry: CellExpectation = {
      row: Number(group(cell, 1)),
      col: Number(group(cell, 2)),
      text: String.fromCodePoint(Number.parseInt(hexes[0] ?? "0", 16)),
    }
    if (attrs.length > 0) entry.attrs = attrs
    exp.expectedCells = [...(exp.expectedCells ?? []), entry]
    return true
  }

  bump(stats.droppedAssertions, `${line.split(/[ =]/)[0] ?? line} (no schema-v1 equivalent)`)
  return false
}

const hasExp = (e: Expectations): boolean => e.expectedCursor !== undefined || e.expectedCells !== undefined

/**
 * Collapse repeated assertions about the same cell. Upstream deliberately
 * asserts one cell several ways (`?screen_row`, `?screen_chars` at two widths,
 * `?screen_cell`), which is good testing and terrible JSON.
 *
 * A genuine DISAGREEMENT between two views of one cell is a converter bug, not
 * something to resolve by picking a winner — so it throws instead.
 */
function mergeCells(cells: readonly CellExpectation[], where: string): CellExpectation[] {
  const byPos = new Map<string, CellExpectation>()
  for (const cell of cells) {
    const key = `${cell.row},${cell.col}`
    const seen = byPos.get(key)
    if (seen === undefined) {
      byPos.set(key, { ...cell, ...(cell.attrs === undefined ? {} : { attrs: [...cell.attrs] }) })
      continue
    }
    if (cell.text !== undefined && seen.text !== undefined && cell.text !== seen.text) {
      throw new Error(
        `${where}: conflicting expectations for cell ${key} — ${JSON.stringify(seen.text)} vs ${JSON.stringify(cell.text)}`,
      )
    }
    if (seen.text === undefined && cell.text !== undefined) seen.text = cell.text
    if (cell.attrs !== undefined) seen.attrs = [...new Set([...(seen.attrs ?? []), ...cell.attrs])]
  }
  return [...byPos.values()].sort((a, b) => a.row - b.row || a.col - b.col)
}

function finalize(exp: Expectations, where: string): Expectations {
  if (exp.expectedCells === undefined) return exp
  return { ...exp, expectedCells: mergeCells(exp.expectedCells, where) }
}

/**
 * `$SEQ a b:` and `$REP n:` wrap a QUERY as well as a PUSH — the vttest files
 * use `$SEQ 2 7: ?screen_row \# = "..."` to assert a band of rows. Expand
 * those into plain lines so the query parser never sees the loop prefix.
 * PUSH-bearing forms are left intact; pushTextOf() concatenates them itself.
 */
function expandLoops(lines: readonly string[]): string[] {
  const out: string[] = []
  for (const line of lines) {
    const seq = /^\$SEQ\s+(-?\d+)\s+(-?\d+):\s*(\?.*)$/.exec(line)
    if (seq !== null) {
      for (let n = Number(group(seq, 1)); n <= Number(group(seq, 2)); n++) {
        out.push(group(seq, 3).replaceAll("\\#", String(n)))
      }
      continue
    }
    const rep = /^\$REP\s+(\d+):\s*(\?.*)$/.exec(line)
    if (rep !== null) {
      for (let n = 0; n < Number(group(rep, 1)); n++) out.push(group(rep, 2))
      continue
    }
    out.push(line)
  }
  return out
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "case"
  )
}

interface Block {
  name: string
  sourceLine: number
  lines: string[]
}

/** Split one .test file into its `!Name` blocks plus the file-level size. */
function parseFile(text: string): { cols: number; rows: number; blocks: Block[]; preamble: string[] } {
  let cols = 80
  let rows = 25
  const blocks: Block[] = []
  const preamble: string[] = []
  let current: Block | null = null
  const lines = text.split("\n")
  for (const [i, raw] of lines.entries()) {
    const line = raw.trim()
    if (line.length === 0 || line.startsWith("#")) continue
    if (line.startsWith("!")) {
      current = { name: line.slice(1).trim(), sourceLine: i + 1, lines: [] }
      blocks.push(current)
      continue
    }
    if (current === null) {
      // Before the first case: a RESIZE sets the file's default geometry
      // (69screen_reflow runs 5x10 so its debug dumps stay small). Everything
      // else is PREAMBLE — session setup that runs before the first named
      // block and is emphatically not decoration.
      const resize = /^RESIZE\s+(\d+),\s*(\d+)/.exec(line)
      if (resize !== null) {
        rows = Number(resize[1])
        cols = Number(resize[2])
        continue
      }
      preamble.push(line)
      continue
    }
    current.lines.push(line)
  }
  return { cols, rows, blocks, preamble }
}

/**
 * Replay the preamble into the segment state.
 *
 * The vttest files are the reason this exists: they paint an entire screen
 * with dozens of directives BEFORE their single `!Output` block, then assert
 * the finished picture. Dropping that preamble produced eight cases that
 * asserted a fully-drawn screen while feeding nothing — and because they then
 * failed on ALL FOUR engines, they looked like a shared engine gap rather than
 * the harness bug they were.
 *
 * A file-level RESIZE is deliberately NOT replayed here: it already set the
 * geometry every case is initialized with, so replaying it as an action would
 * resize a terminal that was born the right size.
 */
function seedPreamble(lines: readonly string[], state: SegmentState): void {
  for (const line of expandLoops(lines)) {
    if (line.startsWith("?")) continue
    const directive = head(line)
    if (directive === "RESET") {
      state.actions = []
      state.poisoned = false
      continue
    }
    const push = pushTextOf(line)
    if (push !== null) {
      state.actions.push({ input: push })
      continue
    }
    if (IGNORED_DIRECTIVES.has(directive)) continue
    if (REJECTING_DIRECTIVES[directive] !== undefined) state.poisoned = true
  }
}

/**
 * Session state carried BETWEEN blocks of one file.
 *
 * This is the single most important thing about the upstream format, and
 * getting it wrong silently manufactures failures: a `!Name` block is NOT an
 * independent test. It is a named section of one continuous terminal session,
 * and the harness resets only on an explicit `RESET`. `!Cursor Down` opens
 * with `PUSH "\e[C"` and asserts `?cursor = 5,1` — row 5 and column 0 come
 * from blocks ABOVE it.
 *
 * The corpus runner gives every case a FRESH backend, so each case must carry
 * the whole input stream since the last RESET as its prefix. Converting blocks
 * standalone produced 46/111 "failures" against vterm — and an almost equal
 * count against xterm.js, which is the tell that the converter was wrong
 * rather than both engines.
 */
interface SegmentState {
  /** Every action replayed since the last RESET — the case's reproducible prefix. */
  actions: Action[]
  /** Set when a block used a directive we cannot reproduce; see poison below. */
  poisoned: boolean
}

/** One thing done to the terminal, in order. */
type Action = { input: string } | { resize: { cols: number; rows: number } }

/**
 * Pack an ordered action list into schema steps, honouring the contract's
 * fixed within-step order (input first, then resize).
 *
 * A run of consecutive inputs coalesces into one string; a resize closes the
 * step it lands in, because anything after it must be applied afterwards and
 * the schema has no way to say "input, resize, input" inside a single step.
 */
function packActions(actions: readonly Action[]): { input?: string; resize?: { cols: number; rows: number } }[] {
  const out: { input?: string; resize?: { cols: number; rows: number } }[] = []
  let cur: { input?: string; resize?: { cols: number; rows: number } } = {}
  const flush = (): void => {
    if (cur.input !== undefined || cur.resize !== undefined) out.push(cur)
    cur = {}
  }
  for (const action of actions) {
    if ("input" in action) {
      if (cur.resize !== undefined) flush()
      cur.input = (cur.input ?? "") + action.input
    } else {
      if (cur.resize !== undefined) flush()
      cur.resize = action.resize
    }
  }
  flush()
  return out
}

function convertBlock(
  block: Block,
  cols: number,
  rows: number,
  suite: string,
  state: SegmentState,
): Record<string, unknown> | null {
  const phases: { actions: Action[]; exp: Expectations }[] = []
  let pending: Action[] = [...state.actions]
  let exp: Expectations = {}
  const localActions: Action[] = []
  let rejection: string | null = null
  let poisons = false
  // Geometry tracked across the segment so screen_row conversions know the
  // CURRENT width — a row query after RESIZE 5,15 asserts against 15 columns.
  let liveCols = cols
  // DECAWM and the last reported glyph — the two facts the deferred-wrap
  // cursor rule needs. Seeded from the segment prefix so a mode set in an
  // earlier block is still in force here.
  let autoWrap = true
  for (const action of pending) if ("input" in action) autoWrap = trackAutoWrap(action.input, autoWrap)
  let lastGlyph: { row: number; endCol: number } | null = null

  const addAction = (action: Action): void => {
    if (hasExp(exp)) {
      phases.push({ actions: pending, exp })
      pending = []
      exp = {}
    }
    pending.push(action)
    localActions.push(action)
  }

  for (const line of expandLoops(block.lines)) {
    if (line.startsWith("?")) {
      applyQuery(line, exp, { cols: liveCols, autoWrap, lastGlyph })
      continue
    }
    const directive = head(line)
    if (directive === "RESET") {
      // Clears the session. Assertions already gathered describe the PRE-reset
      // stream, and there is no reset verb, so a reset that lands mid-block
      // ends the block's convertibility — but the reset is honoured downstream.
      state.actions = []
      state.poisoned = false
      localActions.length = 0
      if (phases.length > 0 || hasExp(exp)) {
        bump(stats.rejected, "mid-case RESET")
        return null
      }
      pending = []
      liveCols = cols
      continue
    }
    const resize = /^RESIZE\s+(\d+),\s*(\d+)/.exec(line)
    if (resize !== null) {
      const next = { rows: Number(group(resize, 1)), cols: Number(group(resize, 2)) }
      addAction({ resize: next })
      liveCols = next.cols
      continue
    }
    const reject = REJECTING_DIRECTIVES[directive]
    if (reject !== undefined) {
      rejection = reject
      poisons = true
      continue
    }
    const push = pushTextOf(line)
    if (push !== null) {
      addAction({ input: push })
      autoWrap = trackAutoWrap(push, autoWrap)
      // A new write opens a new phase; glyph traces below describe THIS write.
      lastGlyph = null
      continue
    }
    const glyph = PUTGLYPH_RE.exec(line)
    if (glyph !== null) {
      lastGlyph = {
        row: Number(group(glyph, 2)),
        endCol: Number(group(glyph, 3)) + Math.max(1, Number(group(glyph, 1))) - 1,
      }
      continue
    }
    if (IGNORED_DIRECTIVES.has(directive)) continue
    // Indented lowercase words are callback traces (ignored); an unknown
    // unindented word is a DSL change we must not silently swallow.
    if (!/^[a-z_#]/.test(directive)) {
      rejection = `unrecognised directive "${directive}"`
      poisons = true
    }
  }
  if (hasExp(exp)) phases.push({ actions: pending, exp })

  // The block's own actions join the segment whether or not the block itself
  // converted — a block we skip still moved the terminal.
  state.actions = [...state.actions, ...localActions]
  if (poisons) state.poisoned = true

  if (rejection !== null) {
    bump(stats.rejected, rejection)
    return null
  }
  if (state.poisoned) {
    // An earlier block in this segment did something we cannot replay, so this
    // block's starting state is unknown. Asserting against a prefix we know to
    // be incomplete is how a corpus grows confident wrong expectations.
    bump(stats.rejected, "unreproducible prefix (earlier block in this RESET segment was not convertible)")
    return null
  }
  if (phases.length === 0) {
    bump(stats.rejected, "no portable assertions")
    return null
  }

  const where = `${suite}:${block.sourceLine} ${block.name}`
  const base = { suite, name: block.name, cols, rows, sourceLine: block.sourceLine, license: LICENSE }

  const steps: Record<string, unknown>[] = []
  for (const phase of phases) {
    const packed = packActions(phase.actions)
    // A phase with no actions at all still needs one to hang its assertions
    // on (assertions immediately after `!Name` on a fresh segment).
    if (packed.length === 0) packed.push({ input: "" })
    for (const [i, action] of packed.entries()) {
      steps.push(i === packed.length - 1 ? { ...action, ...finalize(phase.exp, where) } : { ...action })
    }
  }

  const only = steps[0]
  if (steps.length === 1 && only !== undefined && only.resize === undefined) {
    return { ...base, ...only }
  }
  return { ...base, steps }
}

function main(): void {
  const srcDir = process.argv[2] ?? join(SCRIPT_DIR, "src")
  const casesDir = join(SCRIPT_DIR, "cases")
  const rawDir = join(SCRIPT_DIR, "raw")
  for (const dir of [casesDir, rawDir]) if (existsSync(dir)) rmSync(dir, { recursive: true })

  const perFile: { file: string; found: number; converted: number }[] = []

  for (const file of SOURCE_FILES) {
    const path = join(srcDir, file)
    if (!existsSync(path)) {
      console.error(`missing ${path} — run fetch.ts first`)
      process.exit(1)
    }
    const stem = file.replace(/\.test$/, "")
    const { cols, rows, blocks, preamble } = parseFile(readFileSync(path, "utf8"))
    const suite = `libvterm/${file}`

    const rawRecords: RawRecord[] = []
    let n = 0
    let converted = 0
    const state: SegmentState = { actions: [], poisoned: false }
    seedPreamble(preamble, state)
    for (const block of blocks) {
      stats.blocks++
      rawRecords.push({
        name: block.name,
        sourceLine: block.sourceLine,
        cols,
        rows,
        license: LICENSE,
        lines: block.lines,
      })
      const kase = convertBlock(block, cols, rows, suite, state)
      if (kase === null) continue
      converted++
      stats.converted++
      n++
      const dir = join(casesDir, stem)
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, `${String(n).padStart(4, "0")}-${slug(block.name)}.json`),
        `${JSON.stringify(kase, null, 2)}\n`,
        "utf8",
      )
    }
    mkdirSync(rawDir, { recursive: true })
    writeFileSync(
      join(rawDir, `${stem}.jsonl`),
      rawRecords.map((r) => JSON.stringify(r)).join("\n") + (rawRecords.length > 0 ? "\n" : ""),
      "utf8",
    )
    perFile.push({ file, found: blocks.length, converted })
  }

  const rows_ = perFile
    .map((f) => `| \`${f.file}\` | ${f.found} | ${f.converted} | ${f.found - f.converted} |`)
    .join("\n")
  const rejectRows = [...stats.rejected.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([r, c]) => `| ${c} | ${r} |`)
    .join("\n")
  const dropRows = [...stats.droppedAssertions.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([r, c]) => `| ${c} | ${r} |`)
    .join("\n")

  writeFileSync(
    join(SCRIPT_DIR, "COVERAGE.md"),
    `<!-- GENERATED by extract.ts — do not edit by hand. -->
# libvterm suite — extraction coverage

Pipeline health only: how much of the upstream DSL survived conversion, and
why the rest did not. **Engine pass rates are NOT here** — they live in the
conformance dashboard, per the corpus contract.

**${stats.converted} of ${stats.blocks} upstream blocks converted (${((stats.converted / stats.blocks) * 100).toFixed(1)}%).**

## Per source file

| Source | Blocks found | Converted | Rejected |
| --- | ---: | ---: | ---: |
${rows_}

## Why blocks were rejected

| Count | Reason |
| ---: | --- |
${rejectRows}

## Assertions dropped inside converted blocks

A block converts on the assertions schema v1 can express; these were skipped.
A block kept only if at least one assertion survived, so no case is empty —
but a converted case may assert less than upstream did.

| Count | Dropped assertion |
| ---: | --- |
${dropRows}

Cells whose attribute set was partially mapped (an unmappable libvterm letter
such as \`K\`/\`F\`/\`S\`/\`^\`/\`_\` alongside mappable ones): ${stats.attrsPartial}.

## Schema gaps

- **\`expectedOutput\` is still missing.** Everything the terminal writes BACK
  (cursor-position reports, device attributes, mouse and key encodings) is
  unrepresentable, which is why every MOUSEBTN/INKEY/ENCIN block is rejected.
- **A line-continuation expectation** (libvterm's \`?lineinfo … = cont\`), the
  soft-wrap flag itself.

A resize verb WAS the largest gap; it landed with this suite, and every
reflow-on-resize case now converts.

## Deferred-wrap cursor normalization

${stats.phantomNormalized} cursor expectation(s) were translated from libvterm's pending-wrap
representation (cursor ON the last column) to ours (cursor at col == cols).
See extract.ts \`normalizeDeferredWrapCursor\` for the ruling and its guards;
it fires only where the DSL proves the phantom, so cases whose harness emits no
\`putglyph\` traces, and DECAWM-off cases, are deliberately left alone.
`,
    "utf8",
  )

  const caseCount = existsSync(casesDir)
    ? readdirSync(casesDir, { recursive: true }).filter((f) => String(f).endsWith(".json")).length
    : 0
  console.log(`blocks=${stats.blocks} converted=${stats.converted} cases written=${caseCount}`)
  console.log(`rejections: ${[...stats.rejected.entries()].map(([r, c]) => `${r}=${c}`).join(", ")}`)
}

main()
