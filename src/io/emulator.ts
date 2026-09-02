/**
 * Emulator — eats Events and shows you the picture.
 *
 * The readable picture lives ON the emulator. There is no separate Screen
 * value: nothing ever passes a picture around without the emulator that owns
 * it, and splitting the two only ever produced a second thing to keep in sync.
 * (A snapshot value can be minted later if one earns its existence.)
 *
 * An Emulator is structurally a {@link "./session.ts" | Sink}, so
 * `pipe(source, emulator)` needs no adapter — and an emulator cannot tell a
 * live session from a replayed recording, which is the property the
 * conformance suite rests on.
 */

import type { Event } from "./event.ts"
import type { Cell, Cursor, Modes, Size } from "./picture.ts"

/** Eats Events, shows the picture. */
export interface Emulator {
  /**
   * Feed it anything that happened.
   *
   * May return a Promise; {@link "./pipe.ts" | pipe} awaits it, so a slow
   * emulator throttles its source rather than dropping rows.
   */
  apply(e: Event): void | Promise<void>

  /** What a user would see — the whole buffer as newline-joined text. */
  getText(): string

  /** A single cell, by absolute buffer row and column. */
  getCell(row: number, col: number): Cell

  /**
   * Rows of history above the screen. The screen occupies buffer rows
   * `[scrollback, scrollback + size.rows)`, so this is what turns
   * {@link Emulator.getCell}'s absolute row into a screen row and back — the
   * extent the region views need to split the picture. `0` on the alternate
   * screen, which keeps no history.
   */
  readonly scrollback: number

  /** Where the cursor is, and what it looks like. */
  readonly cursor: Cursor

  /** Every mode's current state. */
  readonly modes: Modes

  /** The emulator's current geometry. */
  readonly size: Size
}
