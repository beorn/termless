/**
 * Global emulator warning registry.
 *
 * Backends that implement WarningExtension push warnings here during feed() calls.
 * Test infrastructure drains warnings after each test to fail on unexpected ones.
 *
 * The registry is intentionally global (module-scoped singleton) so that the vitest
 * setup can check it without needing direct access to individual backend instances.
 */

import type { EmulatorWarning } from "./types.ts"

// ── Global warning accumulator ──

const _warnings: EmulatorWarning[] = []

/**
 * Record an emulator warning. Called by backends during feed().
 */
export function pushWarning(warning: EmulatorWarning): void {
  _warnings.push(warning)
}

/**
 * Get and clear all accumulated warnings.
 * Returns the warnings collected since the last drain.
 */
export function drainWarnings(): EmulatorWarning[] {
  const result = [..._warnings]
  _warnings.length = 0
  return result
}

/**
 * Check if there are any accumulated warnings.
 */
export function hasWarnings(): boolean {
  return _warnings.length > 0
}

/**
 * Clear all accumulated warnings without returning them.
 */
export function clearWarnings(): void {
  _warnings.length = 0
}
