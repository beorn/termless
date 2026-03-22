export { createPeekabooBackend } from "./backend.ts"
export type { PeekabooBackend, PeekabooOptions, TerminalApp } from "./backend.ts"

import { createPeekabooBackend } from "./backend.ts"
import type { TerminalBackend, TerminalOptions } from "../../../src/types.ts"

/** Resolve this backend for the registry. macOS only. */
export async function resolve(opts?: Partial<TerminalOptions>): Promise<TerminalBackend> {
  return createPeekabooBackend(opts)
}
