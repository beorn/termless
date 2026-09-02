/**
 * `.cast` ⇄ io `Recording` codec pair — the io-shaped counterpart to
 * `recording-codec.ts`'s `Trace`-shaped `decodeAsciicast`/`encodeAsciicast`.
 *
 * asciicast v2's four event codes map one-to-one onto the io {@link Event}
 * vocabulary (`@termless/core/io`, `../../io/event.ts`):
 *
 * ```
 *   "o" output   "i" input   "m" mark   "r" control (resize)
 * ```
 *
 * Unlike the deprecated `Trace`-shaped `io` track (`IoEvent`, `../recording.ts`),
 * which has no row shape at all for `control`/`mark`/`exit`, this pair is
 * **total on read**: every well-formed asciicast event becomes an `Event`,
 * nothing is dropped. Write is total the other direction for
 * `output`/`input`/`mark`/`control`-resize; `control`-mode, `control`-signal
 * and `exit` have no asciicast v2 wire form, so {@link writeAsciicast} counts
 * them in its returned `dropped` tally instead of silently losing them.
 *
 *  - {@link readAsciicast}: `.cast` text (or an already-parsed
 *    {@link AsciicastRecording}) → an io {@link Recording}.
 *  - {@link writeAsciicast}: an io {@link Recording} → `.cast` text plus a
 *    drop tally.
 *
 * Timebase — asciicast's `time` is a float in seconds; the io clock is
 * integer microseconds. {@link readAsciicast} routes every timestamp through
 * {@link secondsToMicros}; {@link writeAsciicast} divides back to float
 * seconds. `header.sourceResolution` is always `"s"` on read — asciicast
 * never recorded at finer than second-float precision, so a loader that
 * produced this Recording can say so truthfully (the unterm phase A3 ruling:
 * a loader always sets `sourceResolution`, never defaults it).
 *
 * `recording-codec.ts`'s `decodeAsciicast`/`encodeAsciicast` are now
 * `@deprecated` wrappers built on this pair plus the Trace bridges
 * (`../trace-bridges.ts`) — see that file's docstring for what the
 * `Trace`-shaped door still cannot carry (control, most of the header) that
 * this one does.
 */

import type { Event, MarkEvent } from "../../io/event.ts"
import type { Recording, RecordingHeader } from "../../io/recording.ts"
import type { Size } from "../../io/picture.ts"
import { secondsToMicros } from "../../io/time.ts"
import { parseAsciicast } from "./reader.ts"
import type { AsciicastEvent, AsciicastHeader, AsciicastRecording } from "./types.ts"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const RESIZE_PATTERN = /^(\d+)x(\d+)$/

/**
 * Parse asciicast's `"COLSxROWS"` resize payload (e.g. `"100x30"`).
 *
 * @throws {Error} naming `line` and the malformed value when `data` does not
 * match `COLSxROWS`.
 */
function parseResizeSize(data: string, line: number): Size {
  const match = RESIZE_PATTERN.exec(data)
  if (match === null) {
    throw new Error(
      `readAsciicast: malformed resize data at line ${line}: ${JSON.stringify(data)} (expected "COLSxROWS")`,
    )
  }
  return { cols: Number(match[1]), rows: Number(match[2]) }
}

/**
 * Convert one {@link AsciicastEvent} to its io {@link Event}, at file `line`
 * (1-based: the header occupies line 1, so event index 0 is line 2 —
 * {@link parseAsciicast}'s own numbering).
 */
function eventFromAsciicastEvent(event: AsciicastEvent, line: number): Event {
  const at = secondsToMicros(event.time)
  switch (event.type) {
    case "o":
      return { at, type: "output", data: encoder.encode(event.data) }
    case "i":
      return { at, type: "input", data: encoder.encode(event.data) }
    case "m": {
      const mark: MarkEvent = event.data.length > 0 ? { at, type: "mark", name: event.data } : { at, type: "mark" }
      return mark
    }
    case "r":
      return { at, type: "control", control: "resize", size: parseResizeSize(event.data, line) }
    default: {
      // Reachable only when `source` was handed to readAsciicast as an
      // already-built AsciicastRecording that bypassed parseAsciicast's own
      // code validation — parsed text can't carry an unknown code this far.
      const code: string = event.type
      throw new Error(`readAsciicast: unknown event code ${JSON.stringify(code)} at line ${line}`)
    }
  }
}

/**
 * Read an asciicast v2 recording — `.cast` text, or an already-parsed
 * {@link AsciicastRecording} — into an io {@link Recording}.
 *
 * Header: every asciicast header field survives (`timestamp`, `duration`,
 * `title`, `env`, `theme` carried through when present; `duration` converted
 * with {@link secondsToMicros}), plus `sourceResolution: "s"`.
 *
 * Events: total. `at = secondsToMicros(time)` for every event; `"o"`/`"i"`
 * become `output`/`input` (UTF-8 encoded to {@link Bytes}); `"m"` becomes a
 * `mark` (`name` set to `data`, omitted when `data` is empty); `"r"` becomes
 * a `control`/`resize` event with `size` parsed from `"COLSxROWS"`. None of
 * these are `derived` — they are exactly what the format recorded, not
 * synthesized from other evidence.
 *
 * @throws {Error} naming the line and the offending code, for an event whose
 * `type` is not one of `"o" | "i" | "m" | "r"` — reachable only when `source`
 * is a hand-built {@link AsciicastRecording} that bypassed
 * {@link parseAsciicast}'s own validation.
 * @throws {Error} naming the line and the value, for an `"r"` event whose
 * `data` does not match `"COLSxROWS"`.
 */
export function readAsciicast(source: string | AsciicastRecording): Recording {
  const cast = typeof source === "string" ? parseAsciicast(source) : source

  const header: RecordingHeader = {
    version: 1,
    size: { cols: cast.header.width, rows: cast.header.height },
    sourceResolution: "s",
  }
  if (cast.header.timestamp !== undefined) header.timestamp = cast.header.timestamp
  if (cast.header.duration !== undefined) header.duration = secondsToMicros(cast.header.duration)
  if (cast.header.title !== undefined) header.title = cast.header.title
  if (cast.header.env !== undefined) header.env = cast.header.env
  if (cast.header.theme !== undefined) header.theme = cast.header.theme

  const events = cast.events.map((event, index) => eventFromAsciicastEvent(event, index + 2))

  return { header, events }
}

/** Options for {@link writeAsciicast} — override the header's `title`/`timestamp`. */
export interface WriteAsciicastOptions {
  /** Overrides `recording.header.title`. */
  title?: string
  /** Overrides `recording.header.timestamp`. */
  timestamp?: number
}

/**
 * Count of io {@link Event}s a {@link writeAsciicast} call could not give an
 * asciicast v2 wire form — never silently dropped, always tallied.
 */
export interface AsciicastDroppedTally {
  /** `control`/`mode` events — no asciicast v2 form. */
  mode: number
  /** `control`/`signal` events — no asciicast v2 form. */
  signal: number
  /** `exit` events — no asciicast v2 form. */
  exit: number
}

/** Result of {@link writeAsciicast}: the encoded text plus its drop tally. */
export interface WriteAsciicastResult {
  text: string
  dropped: AsciicastDroppedTally
}

/**
 * Write an io {@link Recording} as asciicast v2 text.
 *
 * `output`/`input`/`mark`/`control`-resize all have a wire form
 * (`"o"`/`"i"`/`"m"`/`"r"`) and always survive. `control`-mode, `control`-signal
 * and `exit` do not — asciicast v2 has no vocabulary for them — so each is
 * counted in the returned `dropped` tally instead of silently vanishing; a
 * caller that needs to know before committing to `.cast` can inspect the
 * tally first.
 *
 * Header: `width`/`height` from `header.size`. `duration` is emitted ONLY
 * when `header.duration` is present — never fabricated from the last event's
 * `at` or defaulted to `0`. This pair is the *symmetric* `.cast` codec: its
 * gold property is `writeAsciicast(readAsciicast(x)).text === x` byte for
 * byte for every well-formed `.cast` (asciicast v2 itself makes `duration`
 * optional, and asciinema's own files often omit it), so a Recording that
 * never measured a duration must round-trip back to text that never claims
 * one either. (The deprecated `encodeAsciicast` wrapper's "always emits a
 * duration" habit — `tests/asciicast/fixtures/README.md`'s oldest-documented
 * fossil — still happens for free on that path without any special case
 * here: it calls this function through `recordingFromTrace`
 * (`../trace-bridges.ts`), whose header always carries the Trace's mandatory
 * `durationMicros`, so `header.duration` is never absent on that route.)
 * `title`/`timestamp` come from the header, with `options` overriding
 * either; `env`/`theme` pass through verbatim when present.
 *
 * Serializes with the same convention every writer in this package already
 * uses for `.cast` — `JSON.stringify` the header, then one
 * `JSON.stringify([time, type, data])` line per event, `\n`-joined, trailing
 * `\n` (`tests/asciicast/fixtures/README.md` "Canonical form") — not
 * {@link createAsciicastWriter}, which can only auto-timestamp from the wall
 * clock and has no way to accept an already-timed `Recording`.
 *
 * `output`/`input` bytes are UTF-8 *decoded* to build the JSON string
 * asciicast requires — **lossy** for a byte sequence that is not valid
 * UTF-8: each invalid sequence becomes U+FFFD, the platform `TextDecoder`
 * default. `.cast` is a text format; a caller carrying binary-unsafe bytes
 * should keep the io `Recording` instead of round-tripping it through
 * asciicast.
 */
export function writeAsciicast(recording: Recording, options?: WriteAsciicastOptions): WriteAsciicastResult {
  const { header: recHeader, events } = recording
  const header: AsciicastHeader = {
    version: 2,
    width: recHeader.size.cols,
    height: recHeader.size.rows,
  }

  const timestamp = options?.timestamp ?? recHeader.timestamp
  if (timestamp !== undefined) header.timestamp = timestamp

  if (recHeader.duration !== undefined) header.duration = recHeader.duration / 1_000_000

  const title = options?.title ?? recHeader.title
  if (title !== undefined) header.title = title
  if (recHeader.env !== undefined) header.env = recHeader.env
  if (recHeader.theme !== undefined) header.theme = recHeader.theme

  const dropped: AsciicastDroppedTally = { mode: 0, signal: 0, exit: 0 }
  const castEvents: AsciicastEvent[] = []
  for (const event of events) {
    const time = event.at / 1_000_000
    switch (event.type) {
      case "output":
        castEvents.push({ time, type: "o", data: decoder.decode(event.data) })
        break
      case "input":
        castEvents.push({ time, type: "i", data: decoder.decode(event.data) })
        break
      case "mark":
        castEvents.push({ time, type: "m", data: event.name ?? "" })
        break
      case "control":
        switch (event.control) {
          case "resize":
            castEvents.push({ time, type: "r", data: `${event.size.cols}x${event.size.rows}` })
            break
          case "mode":
            dropped.mode += 1
            break
          case "signal":
            dropped.signal += 1
            break
        }
        break
      case "exit":
        dropped.exit += 1
        break
    }
  }

  const lines = [JSON.stringify(header)]
  for (const e of castEvents) lines.push(JSON.stringify([e.time, e.type, e.data]))
  return { text: lines.join("\n") + "\n", dropped }
}
