import { createRequire } from "node:module"
import type { Terminal } from "@xterm/xterm"
import { createPlayerFactory } from "./player.ts"
import type { CompiledPlayback, TermlessPlayer, TermlessPlayerOptions } from "./types.ts"

export type { TermlessPlayer, TermlessPlayerOptions } from "./types.ts"

// Loading xterm is synchronous, but only needed when creating our own terminal.
const createPlayer = createPlayerFactory(() => {
  const xterm = createRequire(import.meta.url)("@xterm/xterm") as { Terminal: typeof Terminal }
  return xterm.Terminal
})

export function createTermlessPlayer(
  element: HTMLElement,
  source: string | CompiledPlayback,
  options: TermlessPlayerOptions = {},
): TermlessPlayer {
  return createPlayer(element, source, options)
}
