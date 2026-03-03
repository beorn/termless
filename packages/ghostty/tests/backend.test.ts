/**
 * Ghostty backend tests — stub until libghostty-vt integration is ready.
 *
 * Phase 2 plan:
 * 1. Build libghostty-vt Zig module
 * 2. napigen N-API binding
 * 3. Implement createGhosttyBackend()
 * 4. Run the same test suite as xtermjs backend
 */
import { describe, test, expect } from "vitest"
import { createGhosttyBackend } from "../src/backend.ts"

describe("ghostty backend", () => {
  test("throws not-yet-implemented error", () => {
    expect(() => createGhosttyBackend()).toThrow("not yet implemented")
  })

  test("error message suggests xterm fallback", () => {
    expect(() => createGhosttyBackend()).toThrow("termless-xtermjs")
  })
})
