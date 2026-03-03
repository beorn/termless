/**
 * Terminal fixture factory for vitest tests.
 *
 * Creates Terminal instances that are automatically cleaned up after each test
 * via vitest's afterEach hook.
 *
 * @example
 * ```typescript
 * import { createTerminalFixture } from "viterm/fixture"
 * import { createXtermBackend } from "termless-xtermjs"
 *
 * test("renders prompt", async () => {
 *   const term = createTerminalFixture({
 *     backend: createXtermBackend(),
 *     cols: 80,
 *     rows: 24,
 *   })
 *   term.feed("$ ")
 *   expect(term).toContainText("$ ")
 * })
 * ```
 */

import { afterEach } from "vitest"
import type { Terminal, TerminalCreateOptions } from "../../../src/types.ts"
import { createTerminal } from "../../../src/index.ts"

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
 */
export function createTerminalFixture(options: TerminalCreateOptions): Terminal {
	const terminal = createTerminal(options)
	activeFixtures.push(terminal)
	return terminal
}
