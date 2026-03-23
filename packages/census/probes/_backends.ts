/**
 * Census infrastructure — backend matrix + helpers.
 *
 * The census() function is the only thing probe files need. It handles
 * the backend matrix, lifecycle (init/reset/destroy), and describe blocks.
 *
 * @example
 * ```typescript
 * census("sgr", { spec: "ECMA-48 §8.3.117" }, (b, test) => {
 *   test("sgr-bold", { meta: { description: "Bold" } }, () => {
 *     feed(b, "\x1b[1mX")
 *     expect(b.getCell(0, 0).bold).toBe(true)
 *   })
 *
 *   test("sgr-underline-curly", { meta: { description: "Underline curly" } }, ({ partial }) => {
 *     feed(b, "\x1b[4:3mX")
 *     partial(b.getCell(0, 0).underline, "has underline but not curly")
 *     expect(b.getCell(0, 0).underline).toBe("curly")
 *   })
 * })
 * ```
 */

import {
  describe,
  test as vitestTest,
  beforeAll,
  afterAll,
  beforeEach,
  expect as vitestExpect,
} from "vitest"
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

// ── Census context (destructured in test callbacks) ──

export interface CensusContext {
  /** Mark as partial support if condition is truthy. */
  partial: (condition: unknown, msg: string) => void
  /** Attach a note to the test result. */
  note: (msg: string) => void
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

      // Proxy: lets fn() reference b during describe collection,
      // but actual access happens inside test() callbacks (after beforeAll)
      const proxy = new Proxy({} as TerminalBackend, {
        get(_target, prop) {
          return (_b as any)[prop]
        },
      })

      // Augmented test function that provides { partial, note } in context
      const censusTest: CensusTest = (
        testName: string,
        optsOrFn: TestOpts | TestFn,
        maybeFn?: TestFn,
      ) => {
        const testOpts = typeof optsOrFn === "function" ? {} : optsOrFn
        const testFn = typeof optsOrFn === "function" ? optsOrFn : maybeFn!

        vitestTest(testName, testOpts, (vitestCtx) => {
          const ctx: CensusContext = {
            partial: (condition, msg) => {
              if (condition) {
                // Just add to notes — reporter interprets:
                // fail + notes = partial, fail + no notes = no
                const existing = vitestCtx.meta.notes as string | undefined
                vitestCtx.meta.notes = existing ? `${existing}; ${msg}` : msg
              }
            },
            note: (msg) => {
              const existing = vitestCtx.meta.notes as string | undefined
              vitestCtx.meta.notes = existing ? `${existing}; ${msg}` : msg
            },
          }
          return testFn(ctx)
        })
      }

      describe(category, { meta: { spec: opts.spec } }, () => {
        fn(proxy, censusTest)
      })
    })
  }
}

// Re-export vitest's expect
export { vitestExpect as expect }
export type { TerminalBackend }
