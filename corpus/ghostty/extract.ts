#!/usr/bin/env bun
// Extracts every top-level `test "NAME" { BODY }` block from ghostty's Zig
// terminal-core source files, then auto-converts three mechanical subsets
// into executable JSON cases for vterm.js conformance testing:
//   - Terminal.zig:       Terminal.init(cols,rows) + print/printString-only
//                          input + plainString() dump assertion.
//   - stream_terminal.zig: Terminal.init(cols,rows) + Stream wrapping it +
//                          nextSlice("raw VT bytes")-only input + plainString()
//                          dump assertion (or, narrowly, a getTitle()/
//                          modes.get() accessor-read-then-compare). This is
//                          the closer analog to real emulator conformance
//                          input (literal escape bytes rather than Zig API
//                          calls).
//   - formatter.zig:      same Terminal.init + nextSlice input shape, but
//                          asserted via PageFormatter's full-viewport `.plain`
//                          emit (verified equivalent to plainString() trim
//                          semantics) instead of Terminal.plainString().
//
// Standalone script: node:fs / node:path / node:url only, no termless imports.
//
// Usage:
//   bun extract.ts <path-to-ghostty-src-terminal-dir> [outDir]
//
// See README.md for the raw/ vs cases/ schema and provenance.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { SOURCE_FILES } from "./source-files.ts"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const UPSTREAM_REPO = "https://github.com/ghostty-org/ghostty"

// ---------------------------------------------------------------------------
// Zig lexical helpers
//
// Zig has no block comments, so the only constructs that can hide braces,
// quotes, or `//` from a naive scan are: line comments (`// ... \n`),
// double-quoted strings, single-quoted char literals, and multiline string
// literals (lines starting with `\\`). Both string and char literals use the
// same escape grammar: skipping `\` + the next character always lands past
// the escape, regardless of which specific escape it is, so the scanner
// below doesn't need to enumerate escape kinds to stay brace/quote-safe.
// ---------------------------------------------------------------------------

/** Returns the index of the `}` that matches the `{` at `openBraceIdx`. */
function findBlockEnd(source: string, openBraceIdx: number): number {
  let depth = 0
  let i = openBraceIdx
  const n = source.length
  while (i < n) {
    const ch = source[i]
    if (ch === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i)
      i = nl === -1 ? n : nl
      continue
    }
    if (ch === "\\" && source[i + 1] === "\\") {
      const nl = source.indexOf("\n", i)
      i = nl === -1 ? n : nl
      continue
    }
    if (ch === '"' || ch === "'") {
      const quote = ch
      i++
      while (i < n && source[i] !== quote) {
        i += source[i] === "\\" ? 2 : 1
      }
      i++ // consume closing quote
      continue
    }
    if (ch === "{") {
      depth++
      i++
      continue
    }
    if (ch === "}") {
      depth--
      if (depth === 0) return i
      i++
      continue
    }
    i++
  }
  throw new Error(`unbalanced braces starting at index ${openBraceIdx}`)
}

/** Same-length copy of `source` with `//` line-comment bodies blanked to spaces. */
function maskComments(source: string): string {
  const out: string[] = new Array(source.length)
  const n = source.length
  let i = 0
  while (i < n) {
    const ch = source[i]
    if (ch === "/" && source[i + 1] === "/") {
      while (i < n && source[i] !== "\n") {
        out[i] = " "
        i++
      }
      continue
    }
    if (ch === "\\" && source[i + 1] === "\\") {
      while (i < n && source[i] !== "\n") {
        out[i] = source[i]!
        i++
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      const quote = ch
      out[i] = ch
      i++
      while (i < n && source[i] !== quote) {
        if (source[i] === "\\") {
          out[i] = source[i]!
          i++
          if (i < n) {
            out[i] = source[i]!
            i++
          }
          continue
        }
        out[i] = source[i]!
        i++
      }
      if (i < n) {
        out[i] = source[i]!
        i++
      }
      continue
    }
    out[i] = ch!
    i++
  }
  return out.join("")
}

/** Decodes Zig string/char escape sequences: \n \r \t \\ \' \" \xNN \u{...}. */
function decodeZigEscapes(raw: string): string {
  let out = ""
  let i = 0
  const n = raw.length
  while (i < n) {
    const ch = raw[i]
    if (ch !== "\\") {
      out += ch
      i++
      continue
    }
    const next = raw[i + 1]
    switch (next) {
      case "n":
        out += "\n"
        i += 2
        break
      case "r":
        out += "\r"
        i += 2
        break
      case "t":
        out += "\t"
        i += 2
        break
      case "\\":
        out += "\\"
        i += 2
        break
      case "'":
        out += "'"
        i += 2
        break
      case '"':
        out += '"'
        i += 2
        break
      case "x": {
        const hex = raw.slice(i + 2, i + 4)
        if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
          throw new Error(`bad \\x escape in ${JSON.stringify(raw)} at ${i}`)
        }
        out += String.fromCharCode(parseInt(hex, 16))
        i += 4
        break
      }
      case "u": {
        const m = /^u\{([0-9a-fA-F]+)\}/.exec(raw.slice(i + 1))
        if (!m) throw new Error(`bad \\u escape in ${JSON.stringify(raw)} at ${i}`)
        out += String.fromCodePoint(parseInt(m[1]!, 16))
        i += 1 + m[0].length
        break
      }
      default:
        throw new Error(`unknown escape \\${next} in ${JSON.stringify(raw)} at ${i}`)
    }
  }
  return out
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "")
}

// ---------------------------------------------------------------------------
// Pass 1: raw extraction
// ---------------------------------------------------------------------------

interface RawTestBlock {
  suite: string
  file: string
  testName: string
  sourceLine: number
  zigBody: string
}

function extractTestBlocks(source: string, fileName: string): RawTestBlock[] {
  const blocks: RawTestBlock[] = []
  const declRe = /^test "((?:[^"\\]|\\.)*)"\s*\{/gm
  for (const m of source.matchAll(declRe)) {
    const declStart = m.index!
    const openBraceIdx = declStart + m[0].length - 1
    const closeBraceIdx = findBlockEnd(source, openBraceIdx)
    const zigBody = source.slice(declStart, closeBraceIdx + 1)
    const sourceLine = source.slice(0, declStart).split("\n").length
    let testName: string
    try {
      testName = decodeZigEscapes(m[1]!)
    } catch {
      testName = m[1]!
    }
    blocks.push({ suite: "ghostty", file: fileName, testName, sourceLine, zigBody })
  }

  // Fail loud: cross-check against a dumb literal count so a regex miss
  // (e.g. an unanticipated declaration shape) can't silently under-extract.
  const literalCount = (source.match(/^test "/gm) ?? []).length
  if (blocks.length !== literalCount) {
    throw new Error(
      `${fileName}: extracted ${blocks.length} blocks but found ${literalCount} ` +
        `literal 'test "' lines - declaration regex is missing a shape`,
    )
  }
  return blocks
}

// ---------------------------------------------------------------------------
// Pass 2: mechanical conversion (Terminal.zig + stream_terminal.zig only -
// see COVERAGE.md for why the rest don't qualify)
// ---------------------------------------------------------------------------

interface ConvertedStep {
  input: string
  expectedScreen?: string
  expectedModes?: Record<string, boolean>
  expectedTitle?: string
}

interface ConvertedCase {
  suite: string
  name: string
  cols: number
  rows: number
  input?: string
  steps?: ConvertedStep[]
  expectedScreen?: string
  expectedModes?: Record<string, boolean>
  expectedTitle?: string
  sourceLine: number
  license: string
}

type ConvertResult = { case: ConvertedCase } | { reason: string }

/** Parses `.{ .cols = N, .rows = M }` init-field text; rejects anything else. */
function parseColsRows(initFields: string): { cols: number; rows: number } | { reason: string } {
  const fieldPairs = [...initFields.matchAll(/\.(\w+)\s*=\s*(\d+)/g)]
  const fieldMap: Record<string, number> = {}
  for (const [, key, val] of fieldPairs) fieldMap[key!] = Number(val)
  const fieldNames = Object.keys(fieldMap).sort().join(",")
  if (fieldNames !== "cols,rows") {
    return {
      reason:
        fieldNames === ""
          ? "init() cols/rows are non-literal expressions (variables, not numbers)"
          : `init() has non-cols/rows options: {${fieldNames}}`,
    }
  }
  return { cols: fieldMap.cols!, rows: fieldMap.rows! }
}

/** Default screen-dump binding shape: `const V = try t.plainString(...)`. */
const PLAINSTRING_BIND_RE = /\b(?:const|var)\s+(\w+)\s*=\s*try\s+t\.(?:plainString|plainStringUnwrapped)\(/g

/**
 * Finds the terminal dump string a test ultimately asserts on: the last (by
 * source position) `expectEqualStrings("literal", V)` whose variable `V` is
 * bound via `bindRe` earlier in the test. Shared by every converter that
 * ends in a dump-then-compare assertion, regardless of how the dump is
 * produced — `bindRe` defaults to the `t.plainString()`/`plainStringUnwrapped()`
 * shape (Terminal.zig, stream_terminal.zig); formatter.zig passes a
 * `builder.writer.buffered()` bind instead. Don't duplicate this
 * bind/assert-pairing logic in a new converter — pass a different `bindRe`.
 */
function findExpectedScreen(
  masked: string,
  bindRe: RegExp = PLAINSTRING_BIND_RE,
  bindDescription = "plainString-bound",
): { expectedScreen: string } | { reason: string } {
  const binds = [...masked.matchAll(bindRe)].map((m) => ({ index: m.index!, name: m[1]! }))
  const useRe = /expectEqualStrings\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*(\w+)\s*\)/g
  const uses = [...masked.matchAll(useRe)].map((m) => ({ index: m.index!, text: m[1]!, name: m[2]! }))

  type Pair = { useIndex: number; text: string }
  const pairs: Pair[] = []
  for (const u of uses) {
    let bestIndex = -1
    for (const b of binds) {
      if (b.name === u.name && b.index < u.index && b.index > bestIndex) bestIndex = b.index
    }
    if (bestIndex !== -1) {
      try {
        pairs.push({ useIndex: u.index, text: decodeZigEscapes(u.text) })
      } catch (e) {
        return { reason: `escape decode failed on expected string: ${(e as Error).message}` }
      }
    }
  }
  if (pairs.length === 0) {
    return { reason: `no expectEqualStrings(...) assertion pairs with a ${bindDescription} variable` }
  }
  pairs.sort((a, b) => a.useIndex - b.useIndex)
  return { expectedScreen: pairs[pairs.length - 1]!.text }
}

const TERMINAL_ALLOWED_CALLS = new Set([
  "print",
  "printString",
  "deinit",
  "plainString",
  "plainStringUnwrapped",
  "isDirty",
  "clearDirty",
])

function tryConvertTerminalTest(raw: RawTestBlock): ConvertResult {
  const masked = maskComments(raw.zigBody)

  if (masked.includes("@embedFile")) {
    return { reason: "reads external resource via @embedFile" }
  }

  const anyInitCalls = [...masked.matchAll(/\btry\s+init\(/g)]
  if (anyInitCalls.length !== 1) {
    return { reason: "zero or multiple Terminal instances in one test" }
  }

  const initMatch = /\b(?:var|const)\s+t\s*=\s*try\s+init\(\s*([\w.]+)\s*,\s*\.\{([^}]*)\}\s*\)/.exec(masked)
  if (!initMatch) {
    return { reason: "terminal variable isn't named `t`, or init() call shape not recognized" }
  }
  const [, allocExpr, initFields] = initMatch
  if (allocExpr !== "alloc" && allocExpr !== "testing.allocator") {
    return { reason: `unrecognized allocator expression: ${allocExpr}` }
  }

  const colsRows = parseColsRows(initFields!)
  if ("reason" in colsRows) return colsRows
  const { cols, rows } = colsRows

  const callMatches = [...masked.matchAll(/\bt\.([\w.]+)\(/g)]
  for (const m of callMatches) {
    if (m[1]!.includes(".") || !TERMINAL_ALLOWED_CALLS.has(m[1]!)) {
      return { reason: `uses t.${m[1]}() - outside the print/printString/plainString whitelist` }
    }
  }

  if (/\bt\.[\w.]+\s*=(?!=)/.test(masked)) {
    return { reason: "direct field assignment on the terminal (e.g. scrolling_region.left = N)" }
  }

  const forRe = /for\s*\(\s*"((?:[^"\\]|\\.)*)"\s*\)\s*\|(\w+)\|\s*try\s+t\.print\(\s*\2\s*\)\s*;/g
  const psRe = /t\.printString\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g
  const pcRe = /t\.print\(\s*'((?:[^'\\]|\\.)*)'\s*\)/g

  type Piece = { index: number; text: string }
  const pieces: Piece[] = []
  try {
    for (const m of masked.matchAll(forRe)) pieces.push({ index: m.index!, text: decodeZigEscapes(m[1]!) })
    for (const m of masked.matchAll(psRe)) pieces.push({ index: m.index!, text: decodeZigEscapes(m[1]!) })
    for (const m of masked.matchAll(pcRe)) pieces.push({ index: m.index!, text: decodeZigEscapes(m[1]!) })
  } catch (e) {
    return { reason: `escape decode failed: ${(e as Error).message}` }
  }
  pieces.sort((a, b) => a.index - b.index)

  const rawPrintCallCount = [...masked.matchAll(/\bt\.print(?:String)?\(/g)].length
  if (rawPrintCallCount === 0) return { reason: "no print/printString calls (no input fed)" }
  if (pieces.length !== rawPrintCallCount) {
    return {
      reason: "print/printString called with a non-literal argument (variable, numeric codepoint, or other expression)",
    }
  }

  const input = pieces.map((p) => p.text).join("")
  if (input.length === 0) return { reason: "input decodes to empty string" }

  const expected = findExpectedScreen(masked)
  if ("reason" in expected) return expected

  return {
    case: {
      suite: `ghostty/${raw.file}`,
      name: raw.testName,
      cols,
      rows,
      input,
      expectedScreen: expected.expectedScreen,
      sourceLine: raw.sourceLine,
      license: "MIT",
    },
  }
}

// stream_terminal.zig tests wrap a Terminal in a Stream (the same VT
// byte-stream dispatcher a real emulator front-end would use) and feed input
// via `s.nextSlice("literal bytes")` - including real escape sequences like
// "\x1B[1;1H". This is a *better* conformance-corpus shape than Terminal.zig's
// direct API calls (no Zig-method-to-VT-sequence translation needed - the
// input is already the wire format) so it gets its own converter rather than
// being lumped into the "not Terminal.zig" remainder.
const STREAM_ALLOWED_S_CALLS = new Set(["nextSlice", "deinit"])
const STREAM_ALLOWED_T_CALLS = new Set([
  "deinit",
  "plainString",
  "plainStringUnwrapped",
  "isDirty",
  "clearDirty",
  "getTitle",
])
// Compound (dotted) t.-prefixed calls allowed beyond the simple-name
// whitelist above - kept separate because the whitelist check below treats
// any dotted call name (e.g. t.glyph_glossary.contains()) as unconditionally
// disallowed unless it's listed here.
const STREAM_ALLOWED_T_COMPOUND_CALLS = new Set(["modes.get"])

// Zig Terminal.Mode enum name (t.modes.get(.NAME)) -> this corpus's
// engine-agnostic mode vocabulary (corpus/README.md's expectedModes
// vocabulary; mirrors runner.ts's MODE_MAP). Extend alongside MODE_MAP when a
// new zig mode name is verified against actual raw/ usage - never guess.
const ZIG_MODE_TO_SCHEMA: Record<string, string> = {
  wraparound: "DECAWM",
}

/** Binding shape for formatWithState-adjacent title checks: `expectEqualStrings("literal", t.getTitle().?)`. */
function findExpectedTitle(masked: string): { expectedTitle: string } | { reason: string } | null {
  const re = /expectEqualStrings\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*t\.getTitle\(\)\.\?\s*\)/g
  const matches = [...masked.matchAll(re)]
  if (matches.length === 0) return null
  if (matches.length > 1) return { reason: "multiple t.getTitle() comparisons in one test" }
  try {
    return { expectedTitle: decodeZigEscapes(matches[0]![1]!) }
  } catch (e) {
    return { reason: `escape decode failed on expected title: ${(e as Error).message}` }
  }
}

/**
 * Builds a `steps` case from a test that only asserts mode state via
 * `testing.expect((!)?t.modes.get(.NAME))`, interleaved with `s.nextSlice(...)`
 * feeds - mode state has no single terminal "dump" to compare against (unlike
 * plainString/getTitle), so this converts to multi-phase `steps` rather than
 * a flat case. Consecutive assertions with no feed between them merge into
 * one step so the case doesn't grow spurious empty-input phases.
 */
function tryExtractModeSteps(masked: string): { steps: ConvertedStep[] } | { reason: string } {
  const assertRe = /\btry\s+testing\.expect\(\s*(!)?\s*t\.modes\.get\(\s*\.(\w+)\s*\)\s*\)/g
  const nsRe = /s\.nextSlice\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g

  type Event =
    | { index: number; kind: "feed"; text: string }
    | { index: number; kind: "assert"; negate: boolean; zigName: string }
  const events: Event[] = []
  try {
    for (const m of masked.matchAll(nsRe)) events.push({ index: m.index!, kind: "feed", text: decodeZigEscapes(m[1]!) })
  } catch (e) {
    return { reason: `escape decode failed: ${(e as Error).message}` }
  }
  for (const m of masked.matchAll(assertRe)) {
    events.push({ index: m.index!, kind: "assert", negate: m[1] === "!", zigName: m[2]! })
  }
  events.sort((a, b) => a.index - b.index)

  const steps: ConvertedStep[] = []
  let pendingInput = ""
  for (const ev of events) {
    if (ev.kind === "feed") {
      pendingInput += ev.text
      continue
    }
    const schemaName = ZIG_MODE_TO_SCHEMA[ev.zigName]
    if (!schemaName) return { reason: `unrecognized mode name .${ev.zigName} (extend ZIG_MODE_TO_SCHEMA first)` }
    const want = !ev.negate
    if (pendingInput === "" && steps.length > 0) {
      steps[steps.length - 1]!.expectedModes![schemaName] = want
    } else {
      steps.push({ input: pendingInput, expectedModes: { [schemaName]: want } })
      pendingInput = ""
    }
  }
  if (steps.length === 0) return { reason: "no testing.expect(t.modes.get(...)) assertions found" }
  return { steps }
}

function tryConvertStreamTerminalTest(raw: RawTestBlock): ConvertResult {
  const masked = maskComments(raw.zigBody)

  if (masked.includes("@embedFile")) {
    return { reason: "reads external resource via @embedFile" }
  }

  const initMatches = [
    ...masked.matchAll(/\bvar\s+t:\s*Terminal\s*=\s*try\s*\.init\(\s*([\w.]+)\s*,\s*\.\{([^}]*)\}\s*\)/g),
  ]
  if (initMatches.length !== 1) {
    return { reason: "zero or multiple Terminal instances in one test" }
  }
  const [, allocExpr, initFields] = initMatches[0]!
  if (allocExpr !== "alloc" && allocExpr !== "testing.allocator") {
    return { reason: `unrecognized allocator expression: ${allocExpr}` }
  }

  const colsRows = parseColsRows(initFields!)
  if ("reason" in colsRows) return colsRows
  const { cols, rows } = colsRows

  const streamInitMatches = [
    ...masked.matchAll(/\bvar\s+s:\s*Stream\s*=\s*\.initAlloc\(\s*[\w.]+\s*,\s*\.init\(&t\)\s*\)/g),
  ]
  if (streamInitMatches.length !== 1) {
    return {
      reason:
        "Stream isn't initialized exactly once as `.initAlloc(alloc, .init(&t))` (custom capture handler, different shape, or multiple streams)",
    }
  }

  const sCalls = [...masked.matchAll(/\bs\.(\w+)\(/g)]
  for (const m of sCalls) {
    if (!STREAM_ALLOWED_S_CALLS.has(m[1]!)) {
      return { reason: `uses s.${m[1]}() - outside the nextSlice/deinit whitelist` }
    }
  }

  const tCalls = [...masked.matchAll(/\bt\.([\w.]+)\(/g)]
  for (const m of tCalls) {
    const callName = m[1]!
    const allowed = callName.includes(".")
      ? STREAM_ALLOWED_T_COMPOUND_CALLS.has(callName)
      : STREAM_ALLOWED_T_CALLS.has(callName)
    if (!allowed) {
      return { reason: `uses t.${callName}() - outside the plainString whitelist` }
    }
  }

  if (/\bt\.[\w.]+\s*=(?!=)/.test(masked)) {
    return { reason: "direct field assignment on the terminal" }
  }

  // A test that reads t.modes.get(...) is a multi-phase feed/assert/feed/assert
  // shape (see tryExtractModeSteps) - mutually exclusive with the flat
  // plainString/getTitle single-shot shape below; a test mixing both isn't a
  // shape either path handles, so it's rejected rather than guessed at.
  if (masked.includes("t.modes.get(")) {
    if (masked.includes("t.getTitle(") || /t\.(?:plainString|plainStringUnwrapped)\(/.test(masked)) {
      return { reason: "mixes t.modes.get() with a plainString/getTitle comparison - shape not supported" }
    }
    const stepsResult = tryExtractModeSteps(masked)
    if ("reason" in stepsResult) return stepsResult
    return {
      case: {
        suite: `ghostty/${raw.file}`,
        name: raw.testName,
        cols,
        rows,
        steps: stepsResult.steps,
        sourceLine: raw.sourceLine,
        license: "MIT",
      },
    }
  }

  const nsRe = /s\.nextSlice\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g
  type Piece = { index: number; text: string }
  const pieces: Piece[] = []
  try {
    for (const m of masked.matchAll(nsRe)) pieces.push({ index: m.index!, text: decodeZigEscapes(m[1]!) })
  } catch (e) {
    return { reason: `escape decode failed: ${(e as Error).message}` }
  }
  pieces.sort((a, b) => a.index - b.index)

  const rawCallCount = [...masked.matchAll(/\bs\.nextSlice\(/g)].length
  if (rawCallCount === 0) return { reason: "no nextSlice calls (no input fed)" }
  if (pieces.length !== rawCallCount) {
    return { reason: "nextSlice called with a non-literal argument (variable or other expression)" }
  }

  const input = pieces.map((p) => p.text).join("")
  if (input.length === 0) return { reason: "input decodes to empty string" }

  const screenResult = findExpectedScreen(masked)
  const titleResult = findExpectedTitle(masked)
  if (titleResult !== null && "reason" in titleResult) return titleResult
  if ("reason" in screenResult && titleResult === null) return screenResult

  // Key order matches the pre-existing flat-case shape (expectedScreen before
  // sourceLine/license) via conditional spread, so a test that only ever hits
  // the plainString path (the overwhelming majority) produces byte-identical
  // JSON to before this function grew the getTitle/steps branches.
  return {
    case: {
      suite: `ghostty/${raw.file}`,
      name: raw.testName,
      cols,
      rows,
      input,
      ...(!("reason" in screenResult) ? { expectedScreen: screenResult.expectedScreen } : {}),
      ...(titleResult !== null ? { expectedTitle: titleResult.expectedTitle } : {}),
      sourceLine: raw.sourceLine,
      license: "MIT",
    },
  }
}

// formatter.zig tests exercise PageFormatter directly (Page-level output),
// bypassing Terminal.plainString() entirely - but its full-viewport `.plain`
// emit mode (bare `.plain`, no rectangle/unwrap/trim/html/vt config) produces
// text with the exact same trim semantics as plainString()/viewportPlainString():
// rows joined by "\n", trailing whitespace stripped per row, trailing blank
// rows dropped entirely (verified against raw/formatter.jsonl samples -
// "Page plain trailing blank lines" / "Page plain trailing whitespace" drop
// trailing content exactly like runner.ts's viewportPlainString; "Page plain
// soft-wrapped without unwrap" splits at the physical column exactly like a
// real viewport read, matching plainString's row-by-row semantics). Any other
// PageFormatter config - `.vt` or `.html` emit, `.{ .unwrap = true }`,
// `.{ .trim = false }`, a start_x/end_x/start_y/end_y/trailing_state
// rectangle - diverges from that semantics (confirmed: unwrap collapses a
// soft-wrapped row split that a real viewport read would show) and is
// rejected, not converted.
const FORMATTER_ALLOWED_S_CALLS = STREAM_ALLOWED_S_CALLS
const FORMATTER_ALLOWED_T_CALLS = new Set(["deinit", "vtStream"])
const FORMATTER_BUFFERED_BIND_RE = /\bconst\s+(\w+)\s*=\s*builder\.writer\.buffered\(\)/g

function tryConvertFormatterTest(raw: RawTestBlock): ConvertResult {
  const masked = maskComments(raw.zigBody)

  if (masked.includes("@embedFile")) {
    return { reason: "reads external resource via @embedFile" }
  }

  const initMatches = [
    ...masked.matchAll(/\bvar\s+t\s*=\s*try\s+Terminal\.init\(\s*([\w.]+)\s*,\s*\.\{([^}]*)\}\s*\)/g),
  ]
  if (initMatches.length !== 1) {
    return { reason: "zero or multiple Terminal instances in one test" }
  }
  const [, allocExpr, initFields] = initMatches[0]!
  if (allocExpr !== "alloc" && allocExpr !== "testing.allocator") {
    return { reason: `unrecognized allocator expression: ${allocExpr}` }
  }

  const colsRows = parseColsRows(initFields!)
  if ("reason" in colsRows) return colsRows
  const { cols, rows } = colsRows

  const vtStreamMatches = [...masked.matchAll(/\bvar\s+s\s*=\s*t\.vtStream\(\)/g)]
  if (vtStreamMatches.length !== 1) {
    return { reason: "zero or multiple t.vtStream() bindings (different input-feed shape)" }
  }

  const sCalls = [...masked.matchAll(/\bs\.(\w+)\(/g)]
  for (const m of sCalls) {
    if (!FORMATTER_ALLOWED_S_CALLS.has(m[1]!)) {
      return { reason: `uses s.${m[1]}() - outside the nextSlice/deinit whitelist` }
    }
  }

  const tCalls = [...masked.matchAll(/\bt\.([\w.]+)\(/g)]
  for (const m of tCalls) {
    if (m[1]!.includes(".") || !FORMATTER_ALLOWED_T_CALLS.has(m[1]!)) {
      return { reason: `uses t.${m[1]}() - outside the vtStream/deinit whitelist` }
    }
  }

  if (/\bt\.[\w.]+\s*=(?!=)/.test(masked)) {
    return { reason: "direct field assignment on the terminal" }
  }

  const formatterMatches = [
    ...masked.matchAll(/\bvar\s+formatter:\s*PageFormatter\s*=\s*\.init\(\s*page\s*,\s*\.plain\s*\)/g),
  ]
  if (formatterMatches.length !== 1) {
    return {
      reason:
        "PageFormatter isn't constructed exactly once as `.init(page, .plain)` (different emit mode - .vt/.html - " +
        "or a `.{ .emit = .plain, ... }` config, e.g. unwrap/trim/rectangle)",
    }
  }

  const fieldAssigns = [...masked.matchAll(/\bformatter\.(\w+)\s*=(?!=)/g)]
  for (const m of fieldAssigns) {
    if (m[1] !== "point_map") {
      return {
        reason: `sets formatter.${m[1]} - outside the full-viewport/plain whitelist (point_map is instrumentation-only and allowed)`,
      }
    }
  }

  const formatCalls = [...masked.matchAll(/\bformatter\.formatWithState\(/g)]
  if (formatCalls.length !== 1) {
    return { reason: "zero or multiple formatter.formatWithState() calls" }
  }

  if (!masked.includes("pages.pages.first == pages.pages.last")) {
    return {
      reason: "no single-page assertion (pages.pages.first == pages.pages.last) - full-viewport safety unverifiable",
    }
  }

  const nsRe = /s\.nextSlice\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g
  type Piece = { index: number; text: string }
  const pieces: Piece[] = []
  try {
    for (const m of masked.matchAll(nsRe)) pieces.push({ index: m.index!, text: decodeZigEscapes(m[1]!) })
  } catch (e) {
    return { reason: `escape decode failed: ${(e as Error).message}` }
  }
  pieces.sort((a, b) => a.index - b.index)

  const rawCallCount = [...masked.matchAll(/\bs\.nextSlice\(/g)].length
  if (rawCallCount === 0) return { reason: "no nextSlice calls (no input fed)" }
  if (pieces.length !== rawCallCount) {
    return { reason: "nextSlice called with a non-literal argument (variable or other expression)" }
  }

  const input = pieces.map((p) => p.text).join("")
  if (input.length === 0) return { reason: "input decodes to empty string" }

  const expected = findExpectedScreen(masked, FORMATTER_BUFFERED_BIND_RE, "builder.writer.buffered()-bound")
  if ("reason" in expected) return expected

  return {
    case: {
      suite: `ghostty/${raw.file}`,
      name: raw.testName,
      cols,
      rows,
      input,
      expectedScreen: expected.expectedScreen,
      sourceLine: raw.sourceLine,
      license: "MIT",
    },
  }
}

const CONVERTERS: Record<string, (raw: RawTestBlock) => ConvertResult> = {
  "Terminal.zig": tryConvertTerminalTest,
  "stream_terminal.zig": tryConvertStreamTerminalTest,
  "formatter.zig": tryConvertFormatterTest,
}

function tryConvert(raw: RawTestBlock): ConvertResult {
  const converter = CONVERTERS[raw.file]
  if (!converter) return { reason: "not Terminal.zig or stream_terminal.zig (different API shape)" }
  return converter(raw)
}

// ---------------------------------------------------------------------------
// Non-converted categorization (heuristic, for COVERAGE.md's "what to build
// next" breakdown - not used for correctness, only for reporting).
// ---------------------------------------------------------------------------

const CATEGORY_RULES: [label: string, re: RegExp][] = [
  ["kitty graphics", /kitty/i],
  ["resize / reflow", /resize|reflow/i],
  ["selection", /select/i],
  ["hyperlink", /hyperlink/i],
  ["style / SGR / attributes", /style|attribute|\bsgr\b|bold|color|underline/i],
  ["cursor position / movement", /cursor/i],
  ["scroll / scrollback / scrolling region", /scroll/i],
  ["erase / delete / insert (editing ops)", /erase|delete|insert/i],
  ["mode / DEC private modes", /\bmode\b/i],
  ["tabstops", /tabstop|\btab\b/i],
  ["charset", /charset/i],
  ["dirty-tracking / rendering internals", /dirty/i],
  ["semantic prompt / shell integration", /semantic ?prompt/i],
  ["alt screen switching", /alt screen/i],
  ["grapheme / unicode / wide chars", /grapheme|wide char|unicode|utf-?8/i],
  ["parser state machine (low-level VT bytes)", /^(esc|csi|osc|dcs|apc|c0|c1):/i],
  ["stream handler dispatch", /^(stream|simd):/i],
  ["screen read/write/page internals", /^screen\b/i],
]

function categorize(testName: string): string {
  for (const [label, re] of CATEGORY_RULES) if (re.test(testName)) return label
  return "other / uncategorized"
}

// ---------------------------------------------------------------------------
// I/O helpers
// ---------------------------------------------------------------------------

let filesWritten = 0
let bytesWritten = 0
const validationFailures: string[] = []

function writeJsonValidated(path: string, obj: unknown): void {
  const text = JSON.stringify(obj, null, 2) + "\n"
  writeFileSync(path, text, "utf8")
  filesWritten++
  bytesWritten += Buffer.byteLength(text, "utf8")

  const readBack = readFileSync(path, "utf8")
  try {
    JSON.parse(readBack)
  } catch (e) {
    validationFailures.push(`${path}: ${(e as Error).message}`)
  }
}

/** JSONL: one compact JSON object per line; every line round-trip validated. */
function writeJsonlValidated(path: string, objs: unknown[]): void {
  const text = objs.map((o) => JSON.stringify(o)).join("\n") + "\n"
  writeFileSync(path, text, "utf8")
  filesWritten++
  bytesWritten += Buffer.byteLength(text, "utf8")

  const lines = readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.length > 0)
  if (lines.length !== objs.length) {
    validationFailures.push(`${path}: expected ${objs.length} lines, read back ${lines.length}`)
    return
  }
  for (const [i, line] of lines.entries()) {
    try {
      JSON.parse(line)
    } catch (e) {
      validationFailures.push(`${path}:${i + 1}: ${(e as Error).message}`)
    }
  }
}

function dirSizeBytes(dir: string): number {
  if (!existsSync(dir)) return 0
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) total += dirSizeBytes(p)
    else total += statSync(p).size
  }
  return total
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main(): void {
  const [srcDir, outDirArg] = process.argv.slice(2)
  if (!srcDir) {
    console.error("Usage: bun extract.ts <path-to-ghostty-src-terminal-dir> [outDir]")
    console.error(`Fetch source from: ${UPSTREAM_REPO}/tree/main/src/terminal`)
    process.exit(1)
  }
  const outDir = outDirArg ?? SCRIPT_DIR
  const rawDir = join(outDir, "raw")
  const casesDir = join(outDir, "cases")

  const perFileStats: {
    file: string
    rawCount: number
    convertedCount: number
    hasConverter: boolean
    reasons: Map<string, number>
    categories: Map<string, number>
  }[] = []

  for (const fileName of SOURCE_FILES) {
    const srcPath = join(srcDir, fileName)
    if (!existsSync(srcPath)) {
      console.warn(`skip (not found): ${fileName}`)
      continue
    }
    const source = readFileSync(srcPath, "utf8")
    const blocks = extractTestBlocks(source, fileName)

    const stem = fileName.replace(/\.zig$/, "")
    const casesOutDir = join(casesDir, stem)
    mkdirSync(rawDir, { recursive: true })

    const reasons = new Map<string, number>()
    const categories = new Map<string, number>()
    let convertedCount = 0
    // raw/ is one JSONL per SOURCE FILE, not one JSON per test block: 28
    // reviewable files instead of ~1300 inodes, and an upstream refresh
    // diffs as changed lines instead of a thousand-file churn. Converters
    // iterate blocks; nothing addresses a raw block by filename.
    const rawLines: unknown[] = []

    blocks.forEach((block, idx) => {
      rawLines.push(block)

      const result = tryConvert(block)
      if ("case" in result) {
        const index = String(idx + 1).padStart(4, "0")
        mkdirSync(casesOutDir, { recursive: true })
        writeJsonValidated(join(casesOutDir, `${index}-${slugify(block.testName)}.json`), result.case)
        convertedCount++
      } else {
        reasons.set(result.reason, (reasons.get(result.reason) ?? 0) + 1)
        const cat = categorize(block.testName)
        categories.set(cat, (categories.get(cat) ?? 0) + 1)
      }
    })
    writeJsonlValidated(join(rawDir, `${stem}.jsonl`), rawLines)

    perFileStats.push({
      file: fileName,
      rawCount: blocks.length,
      convertedCount,
      hasConverter: fileName in CONVERTERS,
      reasons,
      categories,
    })
    console.log(`${fileName}: ${blocks.length} test blocks, ${convertedCount} auto-converted`)
  }

  if (validationFailures.length > 0) {
    console.error(`\n${validationFailures.length} JSON files FAILED to round-trip parse:`)
    for (const f of validationFailures) console.error(`  ${f}`)
    process.exit(1)
  }

  writeCoverageReport(join(outDir, "COVERAGE.md"), perFileStats)

  const totalRaw = perFileStats.reduce((s, f) => s + f.rawCount, 0)
  const totalConverted = perFileStats.reduce((s, f) => s + f.convertedCount, 0)
  console.log(`\n${filesWritten} JSON files written (${bytesWritten.toLocaleString()} bytes), all validated.`)
  console.log(`Total: ${totalRaw} raw blocks, ${totalConverted} converted cases.`)
  console.log(`raw/ size: ${dirSizeBytes(rawDir).toLocaleString()} bytes`)
  console.log(`cases/ size: ${dirSizeBytes(casesDir).toLocaleString()} bytes`)
}

function writeCoverageReport(
  path: string,
  stats: {
    file: string
    rawCount: number
    convertedCount: number
    hasConverter: boolean
    reasons: Map<string, number>
    categories: Map<string, number>
  }[],
): void {
  const lines: string[] = []
  lines.push("# ghostty corpus extraction coverage")
  lines.push("")
  lines.push(
    `Generated by \`extract.ts\` from ${UPSTREAM_REPO}. Regenerate with \`bun extract.ts <path-to-zig-files>\`.`,
  )
  lines.push("")
  lines.push("## Totals")
  lines.push("")
  lines.push("| File | Raw test blocks | Auto-converted cases |")
  lines.push("| --- | ---: | ---: |")
  let totalRaw = 0
  let totalConverted = 0
  for (const s of stats) {
    lines.push(`| ${s.file} | ${s.rawCount} | ${s.convertedCount} |`)
    totalRaw += s.rawCount
    totalConverted += s.convertedCount
  }
  lines.push(`| **Total** | **${totalRaw}** | **${totalConverted}** |`)
  lines.push("")
  lines.push(
    "Conversion is scoped to three files whose tests consistently follow a fully " +
      "mechanical shape - init with literal `cols`/`rows`, feed input through a " +
      "narrow whitelisted call, assert once via a plain-text dump:",
  )
  lines.push("")
  lines.push(
    "- **`Terminal.zig`** - `Terminal.init(alloc, .{ .cols = N, .rows = M })` + " +
      "print/printString-only input + `t.plainString()` dump assertion.",
  )
  lines.push(
    "- **`stream_terminal.zig`** - the same `Terminal.init` shape, wrapped in a " +
      '`Stream` (`.initAlloc(alloc, .init(&t))`) fed via `s.nextSlice("literal ' +
      'bytes")` - including real escape sequences like `\\x1B[1;1H`. This is the ' +
      "closer analog to genuine emulator conformance input: no Zig-method-to-VT-" +
      "sequence translation is needed since the literal *is* the wire format. Two " +
      "narrow accessor-read-then-compare extensions also convert here: " +
      "`t.getTitle()` -> `expectedTitle`, and `t.modes.get(.NAME)` -> a multi-phase " +
      "`steps` case of `expectedModes` (mode state has no single dump to assert, so " +
      "it converts to feed/assert/feed/assert phases instead of a flat case).",
  )
  lines.push(
    "- **`formatter.zig`** - the same `Terminal.init` + `t.vtStream()` + " +
      '`s.nextSlice("literal bytes")` input shape, but asserted via `PageFormatter`\'s ' +
      "full-viewport `.plain` emit (bare `.init(page, .plain)`, no rectangle/unwrap/" +
      "trim/html/vt config) instead of `t.plainString()` - verified byte-for-byte " +
      "equivalent trim semantics (row join, trailing-whitespace trim, trailing-blank-" +
      "row drop) before this converter was written. Any other `PageFormatter` config " +
      "diverges from that semantics (e.g. `.unwrap = true` collapses a soft-wrap row " +
      "split a real viewport read would show) and is rejected, not converted.",
  )
  lines.push("")
  lines.push(
    "Every other file needs a distinct future converter, not a variant of any " +
      "shape above: `Screen.zig` tests use a lower-level page/pin API and a " +
      "different input method (`s.testWriteString`); `PageList.zig` and `page.zig` " +
      "operate on pages/pins directly with no VT input at all; `Parser.zig` asserts " +
      "on parser state-machine transitions (no screen); `stream.zig` dispatches into " +
      "a custom capture-handler struct rather than a real `Terminal`; the remaining " +
      "files (`Selection*.zig`, `style.zig`, `sgr.zig`, `modes.zig`, `color.zig`, " +
      "`apc.zig`, `dcs.zig`, `device_*.zig`, `size*.zig`, `focus.zig`, `mouse.zig`, " +
      "`render.zig`, `Tabstops.zig`, `UTF8Decoder.zig`, `StringMap.zig`, " +
      "`x11_color.zig`, `ScreenSet.zig`) test protocol encoding or internal state " +
      "directly rather than input-to-screen-output behavior.",
  )
  lines.push("")

  // Full per-reason breakdown tables are only informative for files that ran
  // through a real converter (Terminal.zig, stream_terminal.zig, formatter.zig)
  // - those have multiple distinct rejection reasons worth ranking. Files with no
  // registered converter at all have exactly one reason ("not X - different
  // API shape"), which just restates the totals table above; listing those
  // 24 times added no information, so they're rolled into one compact table.
  const rawOnly: { file: string; rawCount: number }[] = []
  for (const s of stats) {
    if (s.reasons.size === 0) continue
    if (!s.hasConverter) {
      rawOnly.push({ file: s.file, rawCount: s.rawCount })
      continue
    }
    lines.push(`## ${s.file}: why the remaining ${s.rawCount - s.convertedCount} weren't converted`)
    lines.push("")
    lines.push("| Reason | Count |")
    lines.push("| --- | ---: |")
    const sorted = [...s.reasons.entries()].sort((a, b) => b[1] - a[1])
    for (const [reason, count] of sorted) lines.push(`| ${reason} | ${count} |`)
    lines.push("")
  }

  if (rawOnly.length > 0) {
    lines.push("## Files with no registered converter (raw-only extraction)")
    lines.push("")
    lines.push(
      "Every block from these files is in `raw/` but none were attempted for " +
        "conversion - see the file-by-file rationale above the totals table. The " +
        "category breakdown below is the signal for which one to target next.",
    )
    lines.push("")
    lines.push("| File | Raw test blocks |")
    lines.push("| --- | ---: |")
    for (const f of rawOnly) lines.push(`| ${f.file} | ${f.rawCount} |`)
    lines.push("")
  }

  lines.push("## Non-converted remainder by category (all files, heuristic by test name)")
  lines.push("")
  lines.push("This is the signal for what converter to write next.")
  lines.push("")
  const combined = new Map<string, number>()
  for (const s of stats) {
    for (const [cat, count] of s.categories) combined.set(cat, (combined.get(cat) ?? 0) + count)
  }
  lines.push("| Category | Count |")
  lines.push("| --- | ---: |")
  const sortedCombined = [...combined.entries()].sort((a, b) => b[1] - a[1])
  for (const [cat, count] of sortedCombined) lines.push(`| ${cat} | ${count} |`)
  lines.push("")

  writeFileSync(path, lines.join("\n"), "utf8")
}

main()
