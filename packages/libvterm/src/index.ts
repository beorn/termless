export { createLibvtermBackend } from "./backend.ts"
export { initLibvterm } from "./wasm-bindings.ts"

import { createLibvtermBackend } from "./backend.ts"
import { initLibvterm } from "./wasm-bindings.ts"
import type { TerminalBackend, TerminalOptions } from "../../../src/types.ts"

/** Resolve this backend for the registry. Handles WASM initialization. */
export async function resolve(opts?: Partial<TerminalOptions>): Promise<TerminalBackend> {
  await initLibvterm()
  return createLibvtermBackend(opts)
}
