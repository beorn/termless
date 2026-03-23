/**
 * Census infrastructure — describeBackends() + vitest assertions.
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

// WASM backends — verify full init works before adding
try {
  const ghosttyMod = await import("../../ghostty/src/backend.ts")
  const ghosttyInstance = await ghosttyMod.initGhostty()
  // Verify it actually works
  const testBackend = ghosttyMod.createGhosttyBackend(undefined, ghosttyInstance)
  testBackend.init({ cols: 1, rows: 1 })
  testBackend.destroy()
  backends.push(["ghostty", async () => ghosttyMod.createGhosttyBackend(undefined, ghosttyInstance)])
} catch {
  // Ghostty WASM not available (common in vitest VM context)
}

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
