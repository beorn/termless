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
 * })
 * ```
 */

import { describe, test as vitestTest, beforeAll, afterAll, beforeEach } from "vitest"
import type { TerminalBackend } from "@termless/core"

// ── Backend resolution (top-level await) ──
// Direct imports — import.meta.resolve doesn't work in vitest's VM.

const backends: [string, () => Promise<TerminalBackend>][] = []

// JS backends (always available)
try {
  const mod = await import("../../xtermjs/src/backend.ts")
  mod.createXtermBackend()
  backends.push(["xtermjs", async () => (await import("../../xtermjs/src/backend.ts")).createXtermBackend()])
} catch {}

try {
  const mod = await import("../../vt100/src/backend.ts")
  mod.createVt100Backend()
  backends.push(["vt100", async () => (await import("../../vt100/src/backend.ts")).createVt100Backend()])
} catch {}

// WASM backends — init deferred to beforeAll (top-level await doesn't work for WASM in vitest)
try {
  await import("../../ghostty/src/backend.ts") // verify module exists
  backends.push(["ghostty", async () => {
    const { createGhosttyBackend, initGhostty } = await import("../../ghostty/src/backend.ts")
    const ghostty = await initGhostty()
    return createGhosttyBackend(undefined, ghostty)
  }])
} catch {}

try {
  const mod = await import("../../libvterm/src/backend.ts")
  const b = mod.createLibvtermBackend()
  b.init({ cols: 1, rows: 1 })
  b.destroy()
  backends.push(["libvterm", async () => (await import("../../libvterm/src/backend.ts")).createLibvtermBackend()])
} catch {}

// Native backends (require Rust builds)
try {
  const mod = await import("../../vt100-rust/src/backend.ts")
  mod.loadVt100RustNative()
  backends.push(["vt100-rust", async () => (await import("../../vt100-rust/src/backend.ts")).createVt100RustBackend()])
} catch {}

try {
  const mod = await import("../../alacritty/src/backend.ts")
  mod.loadAlacrittyNative()
  backends.push(["alacritty", async () => (await import("../../alacritty/src/backend.ts")).createAlacrittyBackend()])
} catch {}

try {
  const mod = await import("../../wezterm/src/backend.ts")
  mod.loadWeztermNative()
  backends.push(["wezterm", async () => (await import("../../wezterm/src/backend.ts")).createWeztermBackend()])
} catch {}

try {
  const mod = await import("../../kitty/src/backend.ts")
  mod.loadKittyNative()
  backends.push(["kitty", async () => (await import("../../kitty/src/backend.ts")).createKittyBackend()])
} catch {}

// Peekaboo excluded — it's OS automation, not a terminal emulator.
// Its capabilities depend on whichever real terminal app it's driving.

if (backends.length === 0) {
  console.warn("Warning: No backends available for census")
}

// ── Helpers ──

const enc = new TextEncoder()

export function feed(b: TerminalBackend, text: string): void {
  b.feed(enc.encode(text))
}

// ── Check assertion ──

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
      if (pass) state.passed++
      else state.failed.push(note)
    }

    return {
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
  }
}

export interface CensusContext {
  check: (value: unknown, note: string) => CheckChain
}

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

      beforeAll(async () => {
        _b = await factory()
        _b.init({ cols: 80, rows: 24 })
      })

      afterAll(() => {
        _b.destroy()
      })

      beforeEach(() => {
        _b.reset()
      })

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

          const result = testFn(ctx)

          const finish = () => {
            if (state.total === 0) {
              throw new Error("[census:error] probe has no check() calls")
            }
            const meta = vitestCtx.meta ?? ((vitestCtx as any).meta = {})
            meta.checks = state.total
            meta.passed = state.passed
            if (state.failed.length > 0) {
              meta.notes = state.failed.join("; ")
            }
            if (state.total > 0 && state.passed === 0) {
              throw new Error(`[census:no] ${state.failed.join("; ")}`)
            }
            if (state.failed.length > 0) {
              throw new Error(`[census:partial] ${state.failed.join("; ")}`)
            }
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
