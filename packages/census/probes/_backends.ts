/**
 * Census infrastructure — describeBackends() + vitest assertions.
 *
 * Dynamically discovers all installed backends via the registry API
 * instead of hardcoding imports. Peekaboo is excluded (OS automation,
 * not a terminal emulator).
 *
 * @example
 * ```typescript
 * describeBackends("sgr", (b) => {
 *   test("sgr.bold", () => {
 *     feed(b, "\x1b[1mX")
 *     expect(b.getCell(0, 0).bold).toBe(true)
 *   })
 * })
 * ```
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest"
import type { TerminalBackend } from "@termless/core"
import { createLogger } from "loggily"
import {
  backends as allBackendNames,
  isReady,
  backend as resolveBackend,
} from "../../../src/backends.ts"

const log = createLogger("census")

// ── Backend resolution (dynamic discovery) ──
// Uses the registry to find all installed backends.
// Peekaboo is excluded — it's OS automation, not a terminal emulator.

const EXCLUDED = new Set(["peekaboo"])

const readyNames = allBackendNames().filter((name) => {
  if (EXCLUDED.has(name)) return false
  const ready = isReady(name)
  if (!ready) log.debug("Skipping %s (not ready)", name)
  return ready
})

log.debug("Census will probe %d backends: %s", readyNames.length, readyNames.join(", "))

const backends: [string, () => Promise<TerminalBackend>][] = readyNames.map((name) => [
  name,
  () => resolveBackend(name),
])

if (backends.length === 0) {
  console.warn("Warning: No backends available for census")
}

// ── Helpers ──

const enc = new TextEncoder()

export function feed(b: TerminalBackend, text: string): void {
  b.feed(enc.encode(text))
}

/** Record a note on the current test (appears in report output) */
export function notes(msg: string): void {
  const task = (globalThis as any).__vitest_worker__?.current
  if (task?.meta) {
    task.meta.notes = task.meta.notes ? `${task.meta.notes}; ${msg}` : msg
  }
}

/**
 * Run a test suite against all available backends.
 * Each backend gets its own describe block with init/reset/destroy lifecycle.
 */
export function describeBackends(name: string, fn: (b: TerminalBackend) => void): void {
  for (const [backendName, factory] of backends) {
    describe(backendName, () => {
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

      // Proxy so tests get a live reference
      const proxy = new Proxy({} as TerminalBackend, {
        get(_target, prop) {
          return (_b as any)[prop]
        },
      })

      describe(name, () => {
        fn(proxy)
      })
    })
  }
}

export { test, expect }
export type { TerminalBackend }
