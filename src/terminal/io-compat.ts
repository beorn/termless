/**
 * Adapters from the legacy backend contract to the io primitives.
 *
 * The dependency runs one way: this file points at `src/io/`, and `src/io/`
 * points at nothing. That is why the adapters live here on the legacy side
 * rather than inside io — an adapter in io would invert the law the whole
 * ecosystem rests on.
 *
 * Everything in this file is migration scaffolding.
 *
 * @deprecated REMOVING in unterm phase A4 — once backends implement `Emulator`
 * directly there is nothing left to adapt.
 */

import type { Emulator } from "../io/emulator.ts"
import type { Event } from "../io/event.ts"
import { MODES, type Cell, type Cursor, type Modes, type Size } from "../io/picture.ts"
import type { TerminalBackend } from "./types.ts"

/**
 * Wrap a legacy {@link TerminalBackend} as an {@link Emulator}, so it can sit
 * on the receiving end of `pipe(source, emulator)` today.
 *
 * `size` is a parameter because `TerminalBackend` does not expose its own
 * geometry: `getScrollback()` reports rows but never columns, and the column
 * count lives in `createTerminal`'s closure. The adapter tracks the size across
 * `resize` control events from there.
 *
 * **What each Event does to the picture:**
 *
 * | Event | Effect |
 * |---|---|
 * | `output` | `backend.feed(data)` — the bytes the program wrote |
 * | `input` | nothing. Input goes to the program, not the screen; the program's echo arrives as `output`. Applying it here would double every keystroke. |
 * | `control` / `resize` | `backend.resize(cols, rows)`, and the tracked size follows |
 * | `control` / `mode` | **throws.** A mode change *does* alter the picture and `TerminalBackend` has no setter for it, so dropping it would leave the emulator quietly wrong. |
 * | `control` / `signal` | nothing. A signal does not alter the picture; the resize a `SIGWINCH` causes arrives as its own `resize` event. |
 * | `mark` | nothing. A mark names a position in the stream; by definition it paints no cells. |
 * | `exit` | nothing. It ends the stream; recording sinks finalize on it, emulators do not repaint. |
 *
 * The three no-ops are stated rather than silent: each one is a fact about
 * terminal semantics, not a capability the adapter is missing.
 */
export function emulatorFromBackend(backend: TerminalBackend, size: Size): Emulator {
  let current: Size = { cols: size.cols, rows: size.rows }

  return {
    apply(e: Event): void {
      switch (e.type) {
        case "output":
          backend.feed(e.data)
          return
        case "input":
          return
        case "control":
          switch (e.control) {
            case "resize":
              current = { cols: e.size.cols, rows: e.size.rows }
              backend.resize(e.size.cols, e.size.rows)
              return
            case "mode":
              throw new Error(
                `emulatorFromBackend: backend "${backend.name}" cannot apply a mode control event ` +
                  `(mode="${e.mode}", enabled=${e.enabled}). TerminalBackend has no mode setter — ` +
                  `modes only arrive as escape sequences inside an output event. Dropping it would ` +
                  `leave the emulator silently wrong, so this throws instead.`,
              )
            case "signal":
              return
          }
          return
        case "mark":
          return
        case "exit":
          return
      }
    },

    getText(): string {
      return backend.getText()
    },

    getCell(row: number, col: number): Cell {
      return backend.getCell(row, col)
    },

    get cursor(): Cursor {
      return backend.getCursor()
    },

    get modes(): Modes {
      const modes = {} as Record<(typeof MODES)[number], boolean>
      for (const mode of MODES) modes[mode] = backend.getMode(mode)
      return modes
    },

    get size(): Size {
      return { cols: current.cols, rows: current.rows }
    },
  }
}
