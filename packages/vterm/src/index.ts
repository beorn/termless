export { createVtermBackend } from "./backend.ts"

// Production island guest — a structural mirror of `@termless/xtermjs`'s
// `xtermGuest`, injectable behind the hab deck's ShellGuest seam.
export { vtermGuest, type VtermGuestOptions, type VtermGuestHandle, type VtermGuestChild } from "./viewport-adapter.ts"

import { createVtermBackend } from "./backend.ts"
import type { TerminalBackend, TerminalOptions } from "../../../src/terminal/types.ts"

/** Resolve this backend for the registry. */
export async function resolve(opts?: Partial<TerminalOptions>): Promise<TerminalBackend> {
  return createVtermBackend(opts)
}
