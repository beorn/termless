// Differential conformance runner for the corpus/ suites (README.md is the
// cross-suite contract this file enforces).
//
// The runner is deliberately backend-agnostic: it knows TerminalBackend +
// TerminalReadable and NOTHING about any specific engine, so the same case
// runs against vterm, xterm.js, ghostty, vt100, … and a mismatch is evidence
// about the ENGINE, not about the harness. Consumed by
// tests/corpus-conformance.test.ts; Hab restore tests and the terminfo.dev
// matrix consume the CaseMismatch records it produces.
//
// Validation is STRICT per the corpus contract: an unknown field, a missing
// input flavor, or an unknown mode name is a loud error at load time — never
// a silently ignored case.

import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import type { TerminalBackend, TerminalMode, Cell } from "../src/terminal/types.ts"

// ---------------------------------------------------------------------------
// Case schema (v1) — mirrors corpus/README.md § "Case schema"
// ---------------------------------------------------------------------------

export interface CaseExpectations {
  expectedScreen?: string
  expectedCursor?: { row: number; col: number }
  expectedCells?: CellExpectation[]
  expectedModes?: Record<string, boolean>
  expectedTitle?: string
}

export interface CellExpectation {
  row: number
  col: number
  text?: string
  fg?: string
  bg?: string
  attrs?: string[]
}

export interface CaseStep extends CaseExpectations {
  input: string
}

export interface ConformanceCase extends CaseExpectations {
  suite: string
  name: string
  cols: number
  rows: number
  input?: string
  htsRef?: string
  steps?: CaseStep[]
  sourceLine: number
  license: string
  coverageOf?: string
  /** Set by the loader: absolute path of the case file (for reporting). */
  casePath: string
}

const CASE_FIELDS = new Set([
  "suite",
  "name",
  "cols",
  "rows",
  "input",
  "htsRef",
  "steps",
  "expectedScreen",
  "expectedCursor",
  "expectedCells",
  "expectedModes",
  "expectedTitle",
  "sourceLine",
  "license",
  "coverageOf",
])

const STEP_FIELDS = new Set([
  "input",
  "expectedScreen",
  "expectedCursor",
  "expectedCells",
  "expectedModes",
  "expectedTitle",
])

const EXPECTATION_KEYS = [
  "expectedScreen",
  "expectedCursor",
  "expectedCells",
  "expectedModes",
  "expectedTitle",
] as const

const CELL_ATTRS = new Set(["bold", "italic", "underline", "inverse", "dim", "strikethrough"])

/**
 * Schema mode names are engine-agnostic DEC/xterm vocabulary (the corpus must
 * not embed termless-specific naming); the runner owns the one mapping to
 * termless's TerminalMode. Unknown schema mode = loud validation error — new
 * modes land HERE (and in README.md) first.
 */
const MODE_MAP: Record<string, TerminalMode> = {
  DECAWM: "autoWrap",
  DECTCEM: "cursorVisible",
  ALTSCREEN: "altScreen",
  BRACKETED_PASTE: "bracketedPaste",
  DECCKM: "applicationCursor",
  DECNKM: "applicationKeypad",
}

function hasExpectation(obj: CaseExpectations): boolean {
  return EXPECTATION_KEYS.some((k) => obj[k] !== undefined)
}

function validationError(path: string, message: string): Error {
  return new Error(`invalid corpus case ${path}: ${message}`)
}

/** Strict v1 validation — unknown fields and malformed shapes throw. */
export function validateCase(raw: unknown, casePath: string): ConformanceCase {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw validationError(casePath, "top level is not an object")
  }
  const obj = raw as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    if (!CASE_FIELDS.has(key)) throw validationError(casePath, `unknown field "${key}"`)
  }
  if (typeof obj.suite !== "string") throw validationError(casePath, "missing string `suite`")
  if (typeof obj.name !== "string") throw validationError(casePath, "missing string `name`")
  if (typeof obj.cols !== "number" || typeof obj.rows !== "number") {
    throw validationError(casePath, "missing numeric `cols`/`rows`")
  }
  if (typeof obj.sourceLine !== "number") throw validationError(casePath, "missing numeric `sourceLine`")
  if (typeof obj.license !== "string") throw validationError(casePath, "missing string `license`")

  const flavors = [obj.input !== undefined, obj.htsRef !== undefined, obj.steps !== undefined].filter(Boolean)
  if (flavors.length !== 1) {
    throw validationError(casePath, "exactly one input flavor (input | htsRef | steps) required")
  }
  if (obj.steps !== undefined) {
    if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
      throw validationError(casePath, "`steps` must be a non-empty array")
    }
    if (hasExpectation(obj as CaseExpectations)) {
      throw validationError(casePath, "top-level expectations are disallowed when `steps` is present")
    }
    for (const [i, step] of obj.steps.entries()) {
      const stepObj = step as Record<string, unknown>
      for (const key of Object.keys(stepObj)) {
        if (!STEP_FIELDS.has(key)) throw validationError(casePath, `steps[${i}]: unknown field "${key}"`)
      }
      if (typeof stepObj.input !== "string") throw validationError(casePath, `steps[${i}]: missing string input`)
      if (!hasExpectation(stepObj as CaseExpectations)) {
        throw validationError(casePath, `steps[${i}]: at least one expectation required`)
      }
      validateExpectations(stepObj as CaseExpectations, casePath, `steps[${i}]`)
    }
  } else if (!hasExpectation(obj as CaseExpectations)) {
    throw validationError(casePath, "at least one expectation required")
  } else {
    validateExpectations(obj as CaseExpectations, casePath, "case")
  }

  return { ...(obj as unknown as Omit<ConformanceCase, "casePath">), casePath }
}

function validateExpectations(exp: CaseExpectations, casePath: string, where: string): void {
  if (exp.expectedModes !== undefined) {
    for (const mode of Object.keys(exp.expectedModes)) {
      if (!(mode in MODE_MAP)) {
        throw validationError(casePath, `${where}: unknown mode "${mode}" (extend MODE_MAP + README first)`)
      }
    }
  }
  if (exp.expectedCells !== undefined) {
    for (const [i, cell] of exp.expectedCells.entries()) {
      if (typeof cell.row !== "number" || typeof cell.col !== "number") {
        throw validationError(casePath, `${where}: expectedCells[${i}] missing row/col`)
      }
      for (const attr of cell.attrs ?? []) {
        if (!CELL_ATTRS.has(attr)) {
          throw validationError(casePath, `${where}: expectedCells[${i}] unknown attr "${attr}"`)
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** Load + strictly validate every case under `corpus/<suite>/cases/`. */
export function loadSuiteCases(suiteDir: string): ConformanceCase[] {
  const casesDir = join(suiteDir, "cases")
  if (!existsSync(casesDir)) return []
  const cases: ConformanceCase[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.name.endsWith(".json")) cases.push(validateCase(JSON.parse(readFileSync(p, "utf8")), p))
    }
  }
  walk(casesDir)
  return cases
}

/** Every suite directory (one level under corpus/) that has a cases/ dir. */
export function loadAllCases(corpusDir: string): ConformanceCase[] {
  const cases: ConformanceCase[] = []
  for (const entry of readdirSync(corpusDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) cases.push(...loadSuiteCases(join(corpusDir, entry.name)))
  }
  return cases
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface CaseMismatch {
  suite: string
  name: string
  backend: string
  kind: "screen" | "cursor" | "cell" | "mode" | "title"
  /** steps index when the case is multi-phase; absent for single-phase. */
  step?: number
  expected: unknown
  actual: unknown
}

/** Absolute buffer row of the viewport's top line (offset 0 = at bottom). */
function viewportTop(backend: TerminalBackend): number {
  const sb = backend.getScrollback()
  return sb.viewportTop
}

/**
 * Ghostty's `plainString()` semantics, which the converted expectations were
 * mined against: viewport text, per-row trailing whitespace trimmed, trailing
 * blank rows trimmed.
 */
function viewportPlainString(backend: TerminalBackend, rows: number): string {
  const top = viewportTop(backend)
  const lines: string[] = []
  for (let r = 0; r < rows; r++) {
    lines.push(
      backend
        .getLine(top + r)
        .map((c: Cell) => c.char || " ")
        .join("")
        .replace(/\s+$/, ""),
    )
  }
  return lines.join("\n").replace(/\n+$/, "")
}

function evaluateExpectations(
  backend: TerminalBackend,
  kase: ConformanceCase,
  exp: CaseExpectations,
  step: number | undefined,
  out: CaseMismatch[],
): void {
  const base = { suite: kase.suite, name: kase.name, backend: backend.name, ...(step !== undefined ? { step } : {}) }
  const top = viewportTop(backend)
  if (exp.expectedScreen !== undefined) {
    const actual = viewportPlainString(backend, kase.rows)
    // Per-row trailing-blank trim must not use /\s+$/m: \s matches \n, so a
    // run of interior blank lines collapses to nothing and the case can never
    // assert vertical whitespace.
    const expected = exp.expectedScreen.replace(/[^\S\n]+$/gm, "").replace(/\n+$/, "")
    if (actual !== expected) out.push({ ...base, kind: "screen", expected, actual })
  }
  if (exp.expectedCursor !== undefined) {
    const cursor = backend.getCursor()
    const actual = { row: cursor.y, col: cursor.x }
    if (actual.row !== exp.expectedCursor.row || actual.col !== exp.expectedCursor.col) {
      out.push({ ...base, kind: "cursor", expected: exp.expectedCursor, actual })
    }
  }
  for (const cellExp of exp.expectedCells ?? []) {
    const cell = backend.getCell(top + cellExp.row, cellExp.col)
    const problems: string[] = []
    if (cellExp.text !== undefined && (cell.char || " ") !== cellExp.text) problems.push(`text=${cell.char || " "}`)
    for (const attr of cellExp.attrs ?? []) {
      const actualAttr = attr === "underline" ? cell.underline !== false : cell[attr as keyof Cell] === true
      if (!actualAttr) problems.push(`!${attr}`)
    }
    if (problems.length > 0) {
      out.push({
        ...base,
        kind: "cell",
        expected: cellExp,
        actual: { row: cellExp.row, col: cellExp.col, problems },
      })
    }
  }
  for (const [mode, want] of Object.entries(exp.expectedModes ?? {})) {
    const actual = backend.getMode(MODE_MAP[mode]!)
    if (actual !== want) out.push({ ...base, kind: "mode", expected: { [mode]: want }, actual: { [mode]: actual } })
  }
  if (exp.expectedTitle !== undefined) {
    const actual = backend.getTitle()
    if (actual !== exp.expectedTitle) out.push({ ...base, kind: "title", expected: exp.expectedTitle, actual })
  }
}

/**
 * Run one case against one already-initialized backend. Returns [] on full
 * conformance; one CaseMismatch per failed expectation otherwise. The caller
 * owns backend lifecycle (init/destroy) so a backend factory can be reused
 * across the whole corpus without re-import ceremony.
 */
export function runCaseOnBackend(backend: TerminalBackend, kase: ConformanceCase): CaseMismatch[] {
  const encoder = new TextEncoder()
  const mismatches: CaseMismatch[] = []
  if (kase.steps !== undefined) {
    for (const [i, step] of kase.steps.entries()) {
      backend.feed(encoder.encode(step.input))
      evaluateExpectations(backend, kase, step, i, mismatches)
    }
    return mismatches
  }
  if (kase.htsRef !== undefined) {
    backend.feed(readFileSync(join(kase.casePath, "..", kase.htsRef)))
  } else {
    backend.feed(encoder.encode(kase.input!))
  }
  evaluateExpectations(backend, kase, kase, undefined, mismatches)
  return mismatches
}
