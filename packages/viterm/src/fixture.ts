/**
 * Terminal fixture factory for vitest tests.
 *
 * Creates Terminal instances that are automatically cleaned up after each test
 * via vitest's afterEach hook. Uses xterm.js backend by default.
 *
 * @example
 * ```typescript
 * import { createTestTerminal } from "@termless/test"
 *
 * test("renders prompt", async () => {
 *   const term = createTestTerminal()
 *   term.feed("$ ")
 *   expect(term.screen).toContainText("$ ")
 * })
 * ```
 *
 * For named backends (async):
 * ```typescript
 * import { createTestTerminalByName } from "@termless/test"
 *
 * test("renders on ghostty", async () => {
 *   const term = await createTestTerminalByName({ backendName: "ghostty" })
 *   term.feed("$ ")
 *   expect(term.screen).toContainText("$ ")
 * })
 * ```
 *
 * For cross-backend testing:
 * ```typescript
 * import { describeBackends } from "@termless/test"
 *
 * describeBackends((ctx) => {
 *   test("renders bold", async () => {
 *     const term = await ctx.createTerminal({ cols: 80, rows: 24 })
 *     term.feed("\x1b[1mBold\x1b[0m")
 *     expect(term.cell(0, 0)).toBeBold()
 *   })
 * })
 * ```
 */

import { afterEach, describe } from "vitest"
import type { Terminal, TerminalCreateOptions } from "../../../src/types.ts"
import { createTerminal } from "../../../src/index.ts"
import { createXtermBackend } from "../../xtermjs/src/backend.ts"
import { backend, backends, isReady } from "../../../src/backends.ts"

// ═══════════════════════════════════════════════════════
// Option types
// ═══════════════════════════════════════════════════════

/** Base options shared by both sync and async fixtures. */
export interface TestTerminalOptions {
  cols?: number
  rows?: number
  scrollbackLimit?: number
}

/** Options for createTestTerminal (sync). Backend instance or default xterm.js. */
export interface SyncTestTerminalOptions extends TestTerminalOptions {
  /** Direct backend instance. Defaults to xterm.js if omitted. */
  backend?: TerminalCreateOptions["backend"]
}

/** Options for createTestTerminalByName (async). Backend resolved by name. */
export interface NamedTestTerminalOptions extends TestTerminalOptions {
  /** Backend name from registry (e.g., "ghostty"). */
  backendName: string
}

/** @deprecated Use SyncTestTerminalOptions or NamedTestTerminalOptions */
export type TerminalFixtureOptions = SyncTestTerminalOptions

// ═══════════════════════════════════════════════════════
// Fixture lifecycle
// ═══════════════════════════════════════════════════════

// Track active fixtures for cleanup
const activeFixtures: Terminal[] = []

// Register cleanup hook — runs after each test to close all terminal fixtures
afterEach(async () => {
  for (const t of activeFixtures) {
    await t.close()
  }
  activeFixtures.length = 0
})

// ═══════════════════════════════════════════════════════
// Fixture factories
// ═══════════════════════════════════════════════════════

/**
 * Create a test terminal with automatic cleanup. Uses xterm.js by default.
 */
export function createTestTerminal(options?: SyncTestTerminalOptions): Terminal {
  const backend = options?.backend ?? createXtermBackend()
  const terminal = createTerminal({ ...options, backend })
  activeFixtures.push(terminal)
  return terminal
}

/**
 * Create a test terminal by backend name. Async — handles WASM/native init.
 * Automatic cleanup after each test.
 *
 * @example
 * ```typescript
 * const term = await createTestTerminalByName({ backendName: "ghostty" })
 * term.feed("Hello")
 * expect(term.screen).toContainText("Hello")
 * ```
 */
export async function createTestTerminalByName(options: NamedTestTerminalOptions): Promise<Terminal> {
  const b = await backend(options.backendName)
  const terminal = createTerminal({ ...options, backend: b })
  activeFixtures.push(terminal)
  return terminal
}

// Backward compatibility aliases
/** @deprecated Use createTestTerminal */
export const createTerminalFixture = createTestTerminal
/** @deprecated Use createTestTerminalByName */
export const createTerminalFixtureAsync = createTestTerminalByName

// ═══════════════════════════════════════════════════════
// Cross-backend testing helpers
// ═══════════════════════════════════════════════════════

export interface BackendCase {
  name: string
  createTerminal(opts?: TestTerminalOptions): Promise<Terminal>
}

/**
 * Get test cases for installed backends. Each case provides a factory
 * that creates a terminal with automatic cleanup.
 *
 * @example
 * ```typescript
 * const cases = await backendCases()
 * for (const { name, createTerminal } of cases) {
 *   test(`bold on ${name}`, async () => {
 *     const term = await createTerminal()
 *     term.feed("\x1b[1mB")
 *     expect(term.cell(0, 0)).toBeBold()
 *   })
 * }
 * ```
 */
export async function backendCases(filter?: string[]): Promise<BackendCase[]> {
  const names = filter ?? backends().filter(isReady)
  const cases: BackendCase[] = []

  for (const name of names) {
    cases.push({
      name,
      createTerminal: async (opts?: TestTerminalOptions) => {
        const b = await backend(name)
        const terminal = createTerminal({ ...opts, backend: b })
        activeFixtures.push(terminal)
        return terminal
      },
    })
  }

  return cases
}

/**
 * Run a describe block for each installed backend. The most ergonomic
 * way to write cross-backend tests.
 *
 * @example
 * ```typescript
 * import { describeBackends } from "@termless/test"
 *
 * describeBackends((ctx) => {
 *   test("renders bold", async () => {
 *     const term = await ctx.createTerminal({ cols: 80, rows: 24 })
 *     term.feed("\x1b[1mBold\x1b[0m")
 *     expect(term.cell(0, 0)).toBeBold()
 *   })
 * })
 *
 * // With specific backends:
 * describeBackends(["ghostty", "vt100"], (ctx) => {
 *   test("italic works", async () => { ... })
 * })
 * ```
 */
export function describeBackends(
  backendsOrFn: string[] | ((ctx: BackendCase) => void),
  fn?: (ctx: BackendCase) => void,
): void {
  const filterNames = Array.isArray(backendsOrFn) ? backendsOrFn : undefined
  const testFn = Array.isArray(backendsOrFn) ? fn! : backendsOrFn

  // Get names synchronously — backends()/isReady() reads manifest from disk
  const names: string[] = filterNames ?? backends().filter(isReady)

  for (const name of names) {
    describe(name, () => {
      testFn({
        name,
        createTerminal: async (opts?: TestTerminalOptions) => {
          const b = await backend(name)
          const terminal = createTerminal({ ...opts, backend: b })
          activeFixtures.push(terminal)
          return terminal
        },
      })
    })
  }
}
