export { createKittyBackend, isKittyAvailable } from "./backend.ts"

import { createKittyBackend } from "./backend.ts"
import type { TerminalBackend, TerminalOptions } from "../../../src/types.ts"

/** Resolve this backend for the registry. Requires kitty to be installed. */
export async function resolve(opts?: Partial<TerminalOptions>): Promise<TerminalBackend> {
  return createKittyBackend(opts)
}
