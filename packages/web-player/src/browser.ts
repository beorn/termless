import { Terminal } from "@xterm/xterm"
import { compilePlaybackSource } from "./compile.ts"
import { createPlaybackController } from "./controller.ts"
import type { CompiledPlayback, TermlessPlayer, TermlessPlayerOptions } from "./types.ts"

export type { TermlessPlayer, TermlessPlayerOptions } from "./types.ts"

export function createTermlessPlayer(
  element: HTMLElement,
  source: string | CompiledPlayback,
  options: TermlessPlayerOptions = {},
): TermlessPlayer {
  const playback = typeof source === "string" ? compilePlaybackSource(source, options) : source
  const providedTerminal = options.terminal
  const terminal =
    providedTerminal ??
    new Terminal({
      cols: playback.cols,
      rows: playback.rows,
      convertEol: true,
      ...options.xtermOptions,
    })

  if (!providedTerminal) {
    terminal.open(element)
  }

  const controller = createPlaybackController(
    playback,
    {
      reset: () => terminal.reset(),
      resize: (cols, rows) => terminal.resize(cols, rows),
      write: (data) => terminal.write(data),
    },
    options,
  )

  const dispose = (): void => {
    controller.dispose()
    if (!providedTerminal) {
      terminal.dispose()
    }
  }

  const player: TermlessPlayer = {
    ...controller,
    dispose,
    terminal,
    playback,
  }

  if (options.autoplay ?? false) {
    void player.play()
  }

  return player
}
