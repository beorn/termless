export { createVtermBackend } from "./backend.ts"

import { createVtermBackend } from "./backend.ts"
import type { TerminalBackend, TerminalOptions } from "../../../src/types.ts"

/** Resolve this backend for the registry. */
export async function resolve(opts?: Partial<TerminalOptions>): Promise<TerminalBackend> {
  return createVtermBackend(opts)
}
