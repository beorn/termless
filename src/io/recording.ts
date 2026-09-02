/**
 * Recording — a header plus the Events, saved.
 *
 * One event vocabulary, several containers: stream framing, file, socket. A
 * Recording is the file-shaped container, and replaying it produces a Source
 * an emulator cannot distinguish from a live session.
 *
 * This is the io shape. `recording/recording.ts` names its multi-track
 * container (commands / io / frames) `Trace` — the *other* container over
 * this same event vocabulary. The root barrel's `Recording` export is
 * `Trace`'s `@deprecated` alias until unterm phase A4a, when the alias is
 * deleted and the root barrel's `Recording` becomes this io shape.
 */

import type { Event } from "./event.ts"
import type { Micros } from "./time.ts"
import type { Size } from "./picture.ts"

/** What a recording knows about itself before the first Event. */
export interface RecordingHeader {
  /** Recording model version. */
  version: 1
  /** Terminal geometry at recording start. */
  size: Size
  /** Wall-clock start instant — ms since the Unix epoch. Absent when unknown. */
  timestamp?: number
  /** Total duration on the recording's µs clock. Absent when still being written. */
  duration?: Micros
  /** Human title for the recording. */
  title?: string
  /** Environment captured at recording start (`TERM`, `SHELL`, …). */
  env?: Record<string, string>
  /**
   * Foreground/background/palette theme captured at recording start (e.g.
   * asciicast's `theme`). The io shape has nowhere else to carry it, so a
   * loader that finds one puts it here rather than losing it on the way in.
   */
  theme?: { fg?: string; bg?: string; palette?: string }
  /**
   * The clock resolution the source actually recorded at, declared rather
   * than assumed — an HTS1 `.tty` bundle is `"ms"`, asciicast is `"s"`, a
   * source already on this module's own clock is `"us"`. Every `Event.at` in
   * this Recording is still normalized to integer µs regardless of this
   * field; it only documents how much of that precision is real. A loader
   * always sets it — one that cannot determine the source's resolution must
   * fail rather than default (the unterm phase A3 ruling on source
   * resolution).
   */
  sourceResolution?: "us" | "ms" | "s"
}

/** A header plus the Events, saved. */
export interface Recording {
  header: RecordingHeader
  events: Event[]
}
