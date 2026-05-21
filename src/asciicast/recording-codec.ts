/**
 * `.cast` ⇄ `Recording` codec — symmetric, lossless on the `io` track.
 *
 * asciicast v2 is a stream of direction-tagged byte events (`o` = output,
 * `i` = input, `m` = marker). That maps **directly** onto the in-memory
 * {@link Recording} model's `io` source track — design doc §4 names `.cast`
 * the one *symmetric codec* (unlike `.tape`, which is a lossy compiler).
 *
 *  - {@link decodeAsciicast}: `.cast` → a `Recording` with an `io` track.
 *  - {@link encodeAsciicast}: a `Recording`'s `io` track → `.cast` text.
 *
 * Timebase normalization — asciicast records `time` as a **float in
 * seconds**. The Recording model's clock is **integer microseconds**. Decode
 * routes every timestamp through {@link secondsToMicros}; encode divides back
 * to float seconds. The decode direction is the canonical one — once a `.cast`
 * is decoded, there is no float left in the model.
 *
 * Marker (`m`) events have no `io`-track representation (they are neither
 * input nor output bytes). {@link decodeAsciicast} drops them; a caller that
 * needs markers should read them from {@link parseAsciicast} directly.
 */

import { type Recording, type IoEvent, createRecording, micros, secondsToMicros } from "../recording-model.ts"
import { parseAsciicast } from "./reader.ts"
import type { AsciicastHeader, AsciicastRecording } from "./types.ts"

/** Options for {@link encodeAsciicast}. */
export interface EncodeAsciicastOptions {
  /** Optional `title` for the asciicast header. */
  title?: string
  /** Optional unix `timestamp` for the asciicast header. */
  timestamp?: number
}

/**
 * Decode an {@link AsciicastRecording} into a {@link Recording} carrying an
 * `io` source track.
 *
 * Every `o`/`i` event becomes a direction-tagged {@link IoEvent}; the float
 * `time` is normalized to integer µs. Marker (`m`) events are dropped — they
 * are not byte I/O. The result has no `commands` or `frames` track: a decoded
 * `.cast` is observed-truth only.
 */
export function decodeAsciicast(cast: AsciicastRecording): Recording {
  const io: IoEvent[] = []
  let maxAt = 0
  for (const event of cast.events) {
    if (event.type === "m") continue // markers carry no io bytes
    const at = secondsToMicros(event.time)
    if (at > maxAt) maxAt = at
    io.push({ at, direction: event.type === "o" ? "out" : "in", data: event.data })
  }
  // Header `duration` (float seconds) is authoritative when present; else use
  // the last event's timestamp.
  const durationMicros = cast.header.duration !== undefined ? secondsToMicros(cast.header.duration) : micros(maxAt)
  return createRecording({
    cols: cast.header.width,
    rows: cast.header.height,
    durationMicros,
    io,
  })
}

/** Convenience: parse `.cast` text and decode it into a {@link Recording}. */
export function decodeAsciicastSource(content: string): Recording {
  return decodeAsciicast(parseAsciicast(content))
}

/**
 * Encode a {@link Recording}'s `io` track back into asciicast v2 text.
 *
 * @throws {Error} when the recording has no `io` track — `.cast` is a
 *   serialization of observed bytes, and a recording with only `commands`
 *   (a hand-authored tape) has no byte stream to encode. Use the `.tape`
 *   codegen for an intent-only recording.
 */
export function encodeAsciicast(recording: Recording, options?: EncodeAsciicastOptions): string {
  const io = recording.io
  if (io === undefined || io.length === 0) {
    throw new Error("encodeAsciicast: recording has no io track — nothing to encode as .cast")
  }
  const header: AsciicastHeader = {
    version: 2,
    width: recording.cols,
    height: recording.rows,
    duration: recording.durationMicros / 1_000_000,
  }
  if (options?.title !== undefined) header.title = options.title
  if (options?.timestamp !== undefined) header.timestamp = options.timestamp

  const lines: string[] = [JSON.stringify(header)]
  for (const event of io) {
    // Integer-µs → float seconds (the asciicast timebase).
    const time = event.at / 1_000_000
    const type = event.direction === "out" ? "o" : "i"
    lines.push(JSON.stringify([time, type, event.data]))
  }
  return lines.join("\n") + "\n"
}
