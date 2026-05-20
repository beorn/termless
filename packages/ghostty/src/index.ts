export { createGhosttyBackend, initGhostty } from "./backend.ts"
export { cellsToAnsi } from "./cells-to-ansi.ts"
export {
  renderAnsiPng,
  renderTerminalPng,
  type CanvasTheme,
  type RenderOptions,
  type RenderMeta,
} from "./render.ts"

import { createGhosttyBackend, initGhostty } from "./backend.ts"
import type { TerminalBackend, TerminalOptions } from "../../../src/types.ts"

/** Resolve this backend for the registry. Handles WASM initialization. */
export async function resolve(opts?: Partial<TerminalOptions>): Promise<TerminalBackend> {
  const ghostty = await initGhostty()
  return createGhosttyBackend(opts, ghostty)
}
