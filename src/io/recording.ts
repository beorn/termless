/**
 * Recording — a header plus the Events, saved.
 *
 * One event vocabulary, several containers: stream framing, file, socket. A
 * Recording is the file-shaped container, and replaying it produces a Source
 * an emulator cannot distinguish from a live session.
 *
 * This is the io shape. `recording/recording.ts` still carries the older
 * multi-track `Recording` (commands / io / frames) that today's codecs and
 * viewers read; converging the two is phase A3's job, and until then the io
 * shape is reached at `@termless/core/io` while the multi-track shape stays on
 * the root barrel.
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
}

/** A header plus the Events, saved. */
export interface Recording {
  header: RecordingHeader
  events: Event[]
}
