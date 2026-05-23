export { createXtermBackend } from "./backend.ts"
export {
  XtermAdapter,
  type XtermAdapterChild,
  type XtermAdapterHandle,
  type XtermAdapterOptions,
} from "./viewport-adapter.ts"
export type { ForeignSource } from "@silvery/ag"

import { createXtermBackend } from "./backend.ts"
import type { TerminalBackend, TerminalOptions } from "../../../src/terminal/types.ts"

/** Resolve this backend for the registry. Handles all initialization. */
export async function resolve(opts?: Partial<TerminalOptions>): Promise<TerminalBackend> {
  return createXtermBackend(opts)
}
