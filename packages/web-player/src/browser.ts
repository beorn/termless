// Browser bundlers select xterm's ESM entry, which exports Terminal by name.
import { Terminal } from "@xterm/xterm"
import { createPlayerFactory } from "./player.ts"
import type { CompiledPlayback, TermlessPlayer, TermlessPlayerOptions } from "./types.ts"

export type { TermlessPlayer, TermlessPlayerOptions } from "./types.ts"

const createPlayer = createPlayerFactory(() => Terminal)

export function createTermlessPlayer(
  element: HTMLElement,
  source: string | CompiledPlayback,
  options: TermlessPlayerOptions = {},
): TermlessPlayer {
  return createPlayer(element, source, options)
}
