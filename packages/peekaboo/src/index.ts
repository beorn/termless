export { createPeekabooBackend } from "./backend.ts"
export type { PeekabooBackend, PeekabooOptions, TerminalApp } from "./backend.ts"

export {
  compatScreenshot,
  assertCompatCapable,
  buildWrapperScript,
  type CompatScreenshotOptions,
  type CompatScreenshotResult,
} from "./compat-screenshot.ts"
export {
  detectTerminal,
  getTerminalAdapter,
  isTerminalInstalled,
  compatToTerminalApp,
  COMPAT_TERMINAL_PREFERENCE,
  type CompatTerminal,
  type CompatTerminalMetadata,
  type TerminalAdapter,
} from "./terminal-adapters.ts"

import { createPeekabooBackend } from "./backend.ts"
import type { TerminalBackend, TerminalOptions } from "../../../src/terminal/types.ts"

/** Resolve this backend for the registry. macOS only. */
export async function resolve(opts?: Partial<TerminalOptions>): Promise<TerminalBackend> {
  return createPeekabooBackend(opts)
}
