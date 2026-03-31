export { createVt220Backend } from "./backend.ts"

import { createVt220Backend } from "./backend.ts"
import type { TerminalBackend, TerminalOptions } from "../../../src/types.ts"

/** Resolve this backend for the registry. */
export async function resolve(opts?: Partial<TerminalOptions>): Promise<TerminalBackend> {
  return createVt220Backend(opts)
}
