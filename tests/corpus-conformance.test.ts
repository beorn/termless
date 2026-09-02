/**
 * Corpus conformance: run every corpus/<suite>/cases/ case against every
 * pure backend and diff the resulting terminal state (corpus/README.md is
 * the case contract; corpus/runner.ts is the executor).
 *
 * The ledger corpus/known-gaps.json makes engine gaps DATA instead of red
 * tests: an un-ledgered mismatch fails (new regression or new case), and a
 * ledgered entry that PASSES also fails (stale ledger — ratchet it out).
 * Each ledger key is `<backend>::<suite>::<name>`; the value names the gap
 * so it can graduate into an implementation bead.
 */
import { describe, test, expect, beforeAll, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createXtermBackend } from "../packages/xtermjs/src/backend.ts"
import { createGhosttyBackend, initGhostty } from "../packages/ghostty/src/backend.ts"
import { createVt100Backend } from "../packages/vt100/src/backend.ts"
import { createVtermBackend } from "../packages/vterm/src/backend.ts"
import { vtermEngineIdentity } from "../packages/vterm/src/engine-identity.ts"
import type { TerminalBackend } from "../src/terminal/types.ts"
import { loadAllCases, runCaseOnBackend, validateCase, type CaseMismatch } from "../corpus/runner.ts"

const CORPUS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus")

/**
 * The ledger's header row: the vterm.js the `vterm::` rows were graded
 * against. vterm.js is the one engine that resolves differently per world
 * (published package vs the hh workspace override), so the suite refuses to
 * grade the ledger on a version it was not written for, and every vterm
 * failure text names the package's real path so the world is visible in the red.
 */
const LEDGER_ENGINE_KEY = "_engine"
const vtermEngine = vtermEngineIdentity()
const engineNote: Record<string, string> = {
  vterm: ` [engine ${vtermEngine.name}@${vtermEngine.version} from ${vtermEngine.location}]`,
}

let ghostty: Awaited<ReturnType<typeof initGhostty>>

beforeAll(async () => {
  ghostty = await initGhostty()
})

const backends: [string, () => TerminalBackend][] = [
  ["vterm", () => createVtermBackend()],
  ["xterm", () => createXtermBackend()],
  ["ghostty", () => createGhosttyBackend(undefined, ghostty)],
  ["vt100", () => createVt100Backend()],
]

const cases = loadAllCases(CORPUS_DIR)
const knownGaps = JSON.parse(readFileSync(join(CORPUS_DIR, "known-gaps.json"), "utf8")) as Record<string, string>

describe("corpus differential conformance", () => {
  const active: TerminalBackend[] = []
  afterEach(() => {
    for (const b of active) b.destroy()
    active.length = 0
  })

  test("corpus is non-empty (loader + strict validation reach real cases)", () => {
    expect(cases.length).toBeGreaterThanOrEqual(14)
  })

  test("the ledger names the vterm.js its vterm:: rows were graded against", () => {
    const graded = knownGaps[LEDGER_ENGINE_KEY]
    const resolved = `${vtermEngine.name}@${vtermEngine.version}`
    expect(
      graded,
      `corpus/known-gaps.json has no "${LEDGER_ENGINE_KEY}" header — add "${LEDGER_ENGINE_KEY}": "${resolved}" ` +
        `once the vterm:: rows are graded against it (resolved from ${vtermEngine.location})`,
    ).toBeDefined()
    expect(
      graded,
      `corpus/known-gaps.json was graded against ${graded}, but ${resolved} resolved from ${vtermEngine.location} — ` +
        `re-grade the vterm:: rows on this engine and update "${LEDGER_ENGINE_KEY}"`,
    ).toBe(resolved)
  })

  for (const [name, factory] of backends) {
    describe(name, () => {
      for (const kase of cases) {
        const gapKey = `${name}::${kase.suite}::${kase.name}`
        test(`${kase.suite} :: ${kase.name}`, () => {
          const backend = factory()
          backend.init({ cols: kase.cols, rows: kase.rows })
          active.push(backend)
          const mismatches = runCaseOnBackend(backend, kase)
          const ledgered = knownGaps[gapKey]
          const note = engineNote[name] ?? ""
          if (ledgered !== undefined) {
            expect(
              mismatches.length,
              `ledgered gap now PASSES — remove "${gapKey}" from corpus/known-gaps.json (was: ${ledgered})${note}`,
            ).toBeGreaterThan(0)
            return
          }
          expect(mismatches, formatMismatches(mismatches, note)).toEqual([])
        })
      }
    })
  }
})

function formatMismatches(mismatches: CaseMismatch[], note: string): string {
  return mismatches.length === 0 ? "" : `state mismatches${note}:\n${JSON.stringify(mismatches, null, 2)}`
}

// ---------------------------------------------------------------------------
// Expectation-vocabulary self-tests: the corpus's converted cases only use
// expectedScreen today, but the contract vocabulary is wider — prove each
// evaluator + the strict validator on synthetic cases against the xterm
// reference backend so a future converter lands on tested ground.
// ---------------------------------------------------------------------------

describe("runner expectation vocabulary (synthetic self-tests)", () => {
  function synthetic(extra: Record<string, unknown>): ReturnType<typeof validateCase> {
    return validateCase(
      { suite: "self/test", name: "synthetic", cols: 10, rows: 4, sourceLine: 1, license: "termless", ...extra },
      "<synthetic>",
    )
  }

  function run(extra: Record<string, unknown>): CaseMismatch[] {
    const backend = createXtermBackend()
    backend.init({ cols: 10, rows: 4 })
    try {
      return runCaseOnBackend(backend, synthetic(extra))
    } finally {
      backend.destroy()
    }
  }

  test("expectedCursor", () => {
    expect(run({ input: "ab", expectedCursor: { row: 0, col: 2 } })).toEqual([])
    expect(run({ input: "ab", expectedCursor: { row: 1, col: 0 } })).toHaveLength(1)
  })

  test("expectedCells attrs", () => {
    const boldA = "[1mA[0m"
    expect(run({ input: boldA, expectedCells: [{ row: 0, col: 0, text: "A", attrs: ["bold"] }] })).toEqual([])
    expect(run({ input: "A", expectedCells: [{ row: 0, col: 0, attrs: ["bold"] }] })).toHaveLength(1)
  })

  test("expectedModes via DEC names", () => {
    expect(run({ input: "[?1049h", expectedModes: { ALTSCREEN: true } })).toEqual([])
    expect(run({ input: "x", expectedModes: { ALTSCREEN: false } })).toEqual([])
  })

  test("expectedTitle", () => {
    expect(run({ input: "]0;hello", expectedTitle: "hello" })).toEqual([])
    expect(run({ input: "x", expectedTitle: "hello" })).toHaveLength(1)
  })

  test("steps evaluate per phase with step indices", () => {
    const mismatches = run({
      steps: [
        { input: "A", expectedScreen: "A" },
        { input: "B", expectedScreen: "WRONG" },
      ],
    })
    expect(mismatches).toHaveLength(1)
    expect(mismatches[0]).toMatchObject({ kind: "screen", step: 1 })
  })

  test("strict validation: unknown field, dual input flavor, unknown mode all throw", () => {
    expect(() => synthetic({ input: "x", expectedScreen: "x", bogus: 1 })).toThrow(/unknown field "bogus"/)
    expect(() => synthetic({ input: "x", htsRef: "y.hts", expectedScreen: "x" })).toThrow(/exactly one input flavor/)
    expect(() => synthetic({ input: "x", expectedModes: { NOT_A_MODE: true } })).toThrow(/unknown mode/)
    expect(() => synthetic({ input: "x" })).toThrow(/at least one expectation/)
  })
})
