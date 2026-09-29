export { createGhosttyBackend, initGhostty } from "./backend.ts"
export { cellsToAnsi } from "./cells-to-ansi.ts"
export { renderAnsiPng, renderTerminalPng, type CanvasTheme, type RenderOptions, type RenderMeta } from "./render.ts"

import { createGhosttyBackend, initGhostty } from "./backend.ts"
import type { TerminalBackend, TerminalOptions } from "../../../src/terminal/types.ts"

/** Resolve this backend for the registry. Handles WASM initialization. */
// oxlint-disable-next-line typescript/no-deprecated -- Registry resolution returns the legacy backend lifecycle until unterm phase A4.
export async function resolve(opts?: Partial<TerminalOptions>): Promise<TerminalBackend> {
  const ghostty = await initGhostty()
  return createGhosttyBackend(opts, ghostty)
}
