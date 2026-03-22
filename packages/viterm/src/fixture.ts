/**
 * Terminal fixture factory for vitest tests.
 *
 * Creates Terminal instances that are automatically cleaned up after each test
 * via vitest's afterEach hook. Uses xterm.js backend by default.
 *
 * @example
 * ```typescript
 * import { createTerminalFixture } from "@termless/test"
 *
 * test("renders prompt", async () => {
 *   const term = createTerminalFixture()
 *   term.feed("$ ")
 *   expect(term.screen).toContainText("$ ")
 * })
 * ```
 *
 * For named backends (async):
 * ```typescript
 * import { createTerminalFixtureAsync } from "@termless/test"
 *
 * test("renders on ghostty", async () => {
 *   const term = await createTerminalFixtureAsync({ backendName: "ghostty" })
 *   term.feed("$ ")
 *   expect(term.screen).toContainText("$ ")
 * })
 * ```
 */

import { afterEach } from "vitest"
import type { Terminal, TerminalCreateOptions } from "../../../src/types.ts"
import { createTerminal } from "../../../src/index.ts"
import { createXtermBackend } from "../../xtermjs/src/backend.ts"
import { resolveBackend } from "../../../src/registry.ts"

/** Options for createTerminalFixture. Backend defaults to xterm.js. */
export interface TerminalFixtureOptions {
  /** Direct backend instance. Takes priority over backendName. */
  backend?: TerminalCreateOptions["backend"]
  /** Backend name from registry (e.g., "ghostty"). Requires async fixture. */
  backendName?: string
  cols?: number
  rows?: number
  scrollbackLimit?: number
}

// Track active fixtures for cleanup
const activeFixtures: Terminal[] = []

// Register cleanup hook — runs after each test to close all terminal fixtures
afterEach(async () => {
  for (const t of activeFixtures) {
    await t.close()
  }
  activeFixtures.length = 0
})

/**
 * Create a Terminal fixture that is automatically closed after the test.
 *
 * Wraps createTerminal() and registers the instance for automatic cleanup
 * in afterEach. No manual close() call needed.
 *
 * Uses xterm.js backend by default. Pass `backend` to override.
 */
export function createTerminalFixture(options?: TerminalFixtureOptions): Terminal {
  const backend = options?.backend ?? createXtermBackend()
  const terminal = createTerminal({ ...options, backend })
  activeFixtures.push(terminal)
  return terminal
}

/**
 * Create a Terminal fixture using a named backend from the registry.
 *
 * Async because backend resolution may involve WASM loading or native
 * module initialization. The terminal is automatically closed after the test.
 *
 * @example
 * ```typescript
 * const term = await createTerminalFixtureAsync({ backendName: "ghostty" })
 * term.feed("Hello")
 * expect(term.screen).toContainText("Hello")
 * ```
 */
export async function createTerminalFixtureAsync(
  options: TerminalFixtureOptions & { backendName: string },
): Promise<Terminal> {
  const backend = await resolveBackend(options.backendName)
  const terminal = createTerminal({ ...options, backend })
  activeFixtures.push(terminal)
  return terminal
}
