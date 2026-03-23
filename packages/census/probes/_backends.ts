/**
 * Census infrastructure — backend matrix + check() assertions.
 *
 * @example
 * ```typescript
 * census("sgr", { spec: "ECMA-48 §8.3.117" }, (b, test) => {
 *   test("sgr-bold", { meta: { description: "Bold" } }, ({ check }) => {
 *     feed(b, "\x1b[1mX")
 *     check(b.getCell(0, 0).bold, "bold attribute").toBe(true)
 *   })
 *
 *   test("sgr-underline-curly", { meta: { description: "Underline curly" } }, ({ check }) => {
 *     feed(b, "\x1b[4:3mX")
 *     const cell = b.getCell(0, 0)
 *     check(cell.underline, "has underline").toBeTruthy()
 *     check(cell.underline, "curly variant").toBe("curly")
 *   })
 * })
 * ```
 *
 * Result interpretation:
 * - All checks pass → **yes**
 * - Some checks fail → **partial** (failed check notes recorded)
 * - All checks fail → **no**
 * - Uncaught error (TypeError, null deref) → **error** (probe bug)
 */

import { describe, test as vitestTest, beforeAll, afterAll, beforeEach } from "vitest"
import type { TerminalBackend } from "@termless/core"
import { createXtermBackend } from "@termless/xtermjs"
import { createVt100Backend } from "@termless/vt100"

// ── Backend resolution (top-level await) ──

const backends: [string, () => TerminalBackend][] = [
  ["xtermjs", () => createXtermBackend()],
  ["vt100", () => createVt100Backend()],
]

try {
  const mod = await import("@termless/ghostty")
  const ghostty = await mod.initGhostty()
  backends.push(["ghostty", () => mod.createGhosttyBackend(undefined, ghostty)])
} catch {}

try {
  const mod = await import("../../vt100-rust/src/backend.ts")
  mod.loadVt100RustNative()
  const b = mod.createVt100RustBackend()
  b.init({ cols: 1, rows: 1 })
  b.destroy()
  backends.push(["vt100-rust", () => mod.createVt100RustBackend()])
} catch {}

// ── Helpers ──

const enc = new TextEncoder()

/** Feed a string to a backend as UTF-8 bytes. */
export function feed(b: TerminalBackend, text: string): void {
  b.feed(enc.encode(text))
}

// ── Check assertion (census-specific) ──

interface CheckChain {
  toBe(expected: unknown): void
  toBeTruthy(): void
  toEqual(expected: unknown): void
  toContain(expected: string): void
  toBeGreaterThan(n: number): void
  toBeGreaterThanOrEqual(n: number): void
  toBeNull(): void
  not: {
    toBe(expected: unknown): void
    toBeNull(): void
    toContain(expected: string): void
  }
}

interface CheckState {
  total: number
  passed: number
  failed: string[]
}

function createCheck(state: CheckState) {
  return function check(value: unknown, note: string): CheckChain {
    function record(pass: boolean) {
      state.total++
      if (pass) {
        state.passed++
      } else {
        state.failed.push(note)
      }
    }

    const chain: CheckChain = {
      toBe(expected) { record(value === expected) },
      toBeTruthy() { record(!!value) },
      toEqual(expected) { record(JSON.stringify(value) === JSON.stringify(expected)) },
      toContain(expected) { record(typeof value === "string" && value.includes(expected)) },
      toBeGreaterThan(n) { record(typeof value === "number" && value > n) },
      toBeGreaterThanOrEqual(n) { record(typeof value === "number" && value >= n) },
      toBeNull() { record(value === null) },
      not: {
        toBe(expected) { record(value !== expected) },
        toBeNull() { record(value !== null) },
        toContain(expected) { record(typeof value !== "string" || !value.includes(expected)) },
      },
    }
    return chain
  }
}

// ── Census context ──

export interface CensusContext {
  /** Assert a value with a descriptive note. Never throws — records pass/fail. */
  check: (value: unknown, note: string) => CheckChain
}

// ── Census test type ──

type TestOpts = { meta?: { description?: string; spec?: string } }
type TestFn = (ctx: CensusContext) => void | Promise<void>

export interface CensusTest {
  (name: string, fn: TestFn): void
  (name: string, opts: TestOpts, fn: TestFn): void
}

// ── Census runner ──

export function census(
  category: string,
  opts: { spec?: string },
  fn: (b: TerminalBackend, test: CensusTest) => void,
): void {
  for (const [name, factory] of backends) {
    describe(name, () => {
      let _b: TerminalBackend

      beforeAll(() => {
        _b = factory()
        _b.init({ cols: 80, rows: 24 })
      })

      afterAll(() => {
        _b.destroy()
      })

      beforeEach(() => {
        _b.reset()
      })

      // Proxy: reference b during describe collection,
      // actual access deferred to test callbacks (after beforeAll)
      const proxy = new Proxy({} as TerminalBackend, {
        get(_target, prop) {
          return (_b as any)[prop]
        },
      })

      const censusTest: CensusTest = (
        testName: string,
        optsOrFn: TestOpts | TestFn,
        maybeFn?: TestFn,
      ) => {
        const testOpts = typeof optsOrFn === "function" ? {} : optsOrFn
        const testFn = typeof optsOrFn === "function" ? optsOrFn : maybeFn!

        vitestTest(testName, testOpts, (vitestCtx) => {
          const state: CheckState = { total: 0, passed: 0, failed: [] }
          const ctx: CensusContext = { check: createCheck(state) }

          // Run the probe — uncaught errors (TypeError etc.) propagate as real failures
          const result = testFn(ctx)

          // After probe runs, record results in meta
          const finish = () => {
            const meta = vitestCtx.meta ?? ((vitestCtx as any).meta = {})
            meta.checks = state.total
            meta.passed = state.passed
            if (state.failed.length > 0) {
              meta.notes = state.failed.join("; ")
            }
            // Determine census result:
            // all pass → yes (test passes)
            // some fail → partial (test passes, notes recorded)
            // all fail → no (test fails with assertion)
            if (state.total > 0 && state.passed === 0) {
              // All checks failed → this is "no" — fail the test
              throw new Error(`No support: ${state.failed.join("; ")}`)
            }
            // If some passed and some failed → "partial" — test passes, notes in meta
            // If all passed → "yes" — test passes, no notes
          }

          if (result instanceof Promise) return result.then(finish)
          finish()
        })
      }

      describe(category, { meta: { spec: opts.spec } }, () => {
        fn(proxy, censusTest)
      })
    })
  }
}

export type { TerminalBackend }
