export { createVt100RustBackend, loadVt100RustNative } from "./backend.ts"

import { createVt100RustBackend } from "./backend.ts"
import type { TerminalBackend, TerminalOptions } from "../../../src/types.ts"

/** Resolve this backend for the registry. Loads native Rust bindings. */
export async function resolve(opts?: Partial<TerminalOptions>): Promise<TerminalBackend> {
  return createVt100RustBackend(opts)
}
