/**
 * Shared backend loader for census probes.
 *
 * Resolves all available backends via top-level await. Each probe file
 * imports this module and iterates over the backends array.
 */

import type { TerminalBackend } from "@termless/core"
import { createXtermBackend } from "@termless/xtermjs"
import { createVt100Backend } from "@termless/vt100"

export const backends: [string, () => TerminalBackend][] = [
  ["xtermjs", () => createXtermBackend()],
  ["vt100", () => createVt100Backend()],
]

// Optional: ghostty (requires WASM init)
try {
  const mod = await import("@termless/ghostty")
  const ghostty = await mod.initGhostty()
  backends.push(["ghostty", () => mod.createGhosttyBackend(undefined, ghostty)])
} catch {
  // ghostty WASM not available
}

// Optional: vt100-rust (requires native module)
try {
  const mod = await import("../../vt100-rust/src/backend.ts")
  mod.loadVt100RustNative()
  // Verify it actually works
  const b = mod.createVt100RustBackend()
  b.init({ cols: 1, rows: 1 })
  b.destroy()
  backends.push(["vt100-rust", () => mod.createVt100RustBackend()])
} catch {
  // vt100-rust native module not available
}

const enc = new TextEncoder()

/** Feed a string to a backend as UTF-8 bytes. */
export function feed(b: TerminalBackend, text: string): void {
  b.feed(enc.encode(text))
}

export { PartialSupport } from "../src/types.ts"
export type { TerminalBackend } from "@termless/core"

/**
 * Assert feature support. Unifies yes/no/partial into one call.
 *
 * @example
 * ```typescript
 * support(cell.bold)                    // yes or no
 * support(cell.underline === "curly", { // yes, partial, or no
 *   partial: cell.underline,            // truthy → partial, falsy → no
 *   notes: "has underline but not curly"
 * })
 * ```
 */
export function support(
  condition: boolean,
  opts?: { partial?: unknown; notes?: string },
): void {
  if (condition) return // yes — pass
  if (opts?.partial) throw new PartialSupport(opts.notes ?? String(opts.partial))
  expect(condition).toBe(true) // no — fail
}

// Need expect for the fail case
import { expect } from "vitest"
