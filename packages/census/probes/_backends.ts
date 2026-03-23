/**
 * Census infrastructure — backend matrix + helpers.
 *
 * The census() function is the only thing probe files need. It handles
 * the backend matrix, lifecycle (init/reset/destroy), and describe blocks.
 */

import { describe, beforeAll, afterAll, beforeEach, expect as vitestExpect } from "vitest"
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

/**
 * Attach a note to the current test result. The reporter includes this
 * in the census output regardless of pass/fail.
 */
export function note(msg: string, level?: "partial" | "info"): void {
  // getCurrentTest() may not be available, so we store on a thread-local-ish global
  ;(globalThis as any).__census_note = msg
  ;(globalThis as any).__census_level = level
}

/**
 * Mark the current test as partial support if condition is truthy.
 * Call before the expect() that will fail — the reporter reads the
 * level to distinguish partial from no.
 */
export function partial(condition: unknown, msg: string): void {
  if (condition) note(msg, "partial")
}

export { PartialSupport } from "../src/types.ts"

// ── Census runner ──

/**
 * Define a census probe suite. Runs the probes against all available backends.
 *
 * The callback receives a proxy that lazily accesses the backend — this is
 * necessary because describe blocks run synchronously during collection,
 * but the backend is only initialized in beforeAll.
 *
 * @example
 * ```typescript
 * census("sgr", { spec: "ECMA-48 §8.3.117" }, (b) => {
 *   test("sgr-bold", { meta: { description: "Bold" } }, () => {
 *     feed(b, "\x1b[1mX")
 *     expect(b.getCell(0, 0).bold).toBe(true)
 *   })
 * })
 * ```
 */
export function census(
  category: string,
  opts: { spec?: string },
  fn: (b: TerminalBackend) => void,
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
        ;(globalThis as any).__census_note = undefined
        ;(globalThis as any).__census_level = undefined
      })

      // Proxy: lets fn() reference b during describe collection,
      // but actual access happens inside test() callbacks (after beforeAll)
      const proxy = new Proxy({} as TerminalBackend, {
        get(_target, prop) {
          return (_b as any)[prop]
        },
      })

      describe(category, { meta: { spec: opts.spec } }, () => {
        fn(proxy)
      })
    })
  }
}

// Re-export vitest's expect (probe files need it)
export { vitestExpect as expect }
export type { TerminalBackend }
