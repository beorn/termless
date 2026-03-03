import type { TerminalBackend, TerminalOptions } from "termless"

/**
 * Create a Ghostty backend for termless.
 *
 * NOT YET IMPLEMENTED — depends on libghostty-vt C API + napigen viability.
 * See the termless design doc (bead km-termless) for Phase 2 plan.
 */
export function createGhosttyBackend(_opts?: Partial<TerminalOptions>): TerminalBackend {
  throw new Error(
    "termless-ghostty is not yet implemented. " +
      "Use termless-xtermjs as a fallback: createXtermBackend() from 'termless-xtermjs'",
  )
}
