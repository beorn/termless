/**
 * Census infrastructure — describeBackends() + vitest assertions.
 *
 * Dynamically discovers all installed backends from backends.json manifest,
 * probing each with direct imports (import.meta.resolve doesn't work in
 * vitest's VM context). Peekaboo is excluded — it's OS automation, not a
 * terminal emulator.
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
import { manifest } from "../../../src/backends.ts"

const log = createLogger("census")

// ── Backend resolution (dynamic discovery) ──
// Reads the manifest for all backend names, then probes each via direct import.
// Direct imports are needed because import.meta.resolve doesn't work in vitest.

const EXCLUDED = new Set(["peekaboo"])

type BackendFactory = () => Promise<TerminalBackend>

const backends: [string, BackendFactory][] = []

// Map of backend name → relative import path from this file
const BACKEND_PATHS: Record<string, string> = {
  xtermjs: "../../xtermjs/src/backend.ts",
  vt100: "../../vt100/src/backend.ts",
  ghostty: "../../ghostty/src/backend.ts",
  alacritty: "../../alacritty/src/backend.ts",
  wezterm: "../../wezterm/src/backend.ts",
  "vt100-rust": "../../vt100-rust/src/backend.ts",
  libvterm: "../../libvterm/src/backend.ts",
  kitty: "../../kitty/src/backend.ts",
  "ghostty-native": "../../ghostty-native/src/backend.ts",
}

const m = manifest()
const allNames = Object.keys(m.backends).filter((name) => !EXCLUDED.has(name))

for (const name of allNames) {
  const importPath = BACKEND_PATHS[name]
  if (!importPath) {
    log.debug?.(`Skipping ${name} (no import path configured)`)
    continue
  }

  try {
    const mod = await import(importPath)

    // Try to create an instance to verify the backend actually works
    // Different backends need different init patterns
    const entry = m.backends[name]!
    let factory: BackendFactory

    if (entry.type === "wasm") {
      // WASM backends need async init
      if (name === "ghostty") {
        const instance = await mod.initGhostty()
        const testBackend = mod.createGhosttyBackend(undefined, instance)
        testBackend.init({ cols: 1, rows: 1 })
        testBackend.destroy()
        factory = async () => mod.createGhosttyBackend(undefined, instance)
      } else if (name === "libvterm") {
        const b = mod.createLibvtermBackend()
        b.init({ cols: 1, rows: 1 })
        b.destroy()
        factory = async () => mod.createLibvtermBackend()
      } else {
        continue
      }
    } else if (entry.type === "native") {
      // Native backends need their .node file to be built
      // The load* function will throw if not built
      const loadFn = Object.keys(mod).find((k) => k.startsWith("load"))
      if (loadFn) mod[loadFn]()

      const createFn = Object.keys(mod).find((k) => k.startsWith("create"))!
      factory = async () => mod[createFn]()
    } else {
      // JS backends — just create directly
      const createFn = Object.keys(mod).find((k) => k.startsWith("create"))!
      mod[createFn]() // Verify it works
      factory = async () => mod[createFn]()
    }

    backends.push([name, factory])
    log.debug?.(`Added backend: ${name} (${entry.type})`)
  } catch {
    log.debug?.(`Skipping ${name} (import/init failed)`)
  }
}

log.debug?.(`Census will probe ${backends.length} backends: ${backends.map(([n]) => n).join(", ")}`)

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
