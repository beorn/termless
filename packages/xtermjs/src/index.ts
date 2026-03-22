export { createXtermBackend } from "./backend.ts"

import { createXtermBackend } from "./backend.ts"
import type { TerminalBackend, TerminalOptions } from "../../../src/types.ts"

/** Resolve this backend for the registry. Handles all initialization. */
export async function resolve(opts?: Partial<TerminalOptions>): Promise<TerminalBackend> {
  return createXtermBackend(opts)
}
