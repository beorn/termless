/**
 * `.cast` ⇄ `Recording` codec — the deprecated `Trace`-shaped door.
 *
 * @deprecated REPLACED by the io-shaped pair in `./io-codec.ts`
 * (`readAsciicast`/`writeAsciicast`), which speaks the full io {@link Event}
 * vocabulary (`output`/`input`/`control`/`mark`/`exit`) rather than only the
 * `io` track's direction-tagged bytes. {@link decodeAsciicast} and
 * {@link encodeAsciicast} are now thin wrappers composing that pair with the
 * Trace bridges (`../trace-bridges.ts`), kept only so every existing caller
 * of this `Trace`-shaped signature keeps working through unterm phase A4a.
 *
 *  - {@link decodeAsciicast}: `.cast` → a `Recording` (= `Trace`) with an
 *    `io` track — `traceFromRecording(readAsciicast(cast)).trace`.
 *  - {@link encodeAsciicast}: a `Recording`'s `io` track → `.cast` text —
 *    `writeAsciicast(recordingFromTrace(recording), options).text`.
 *
 * What composing through `Trace` still loses, now measured precisely against
 * the lossless io-shaped pair rather than assumed: `traceFromRecording` has
 * no `io`-track row shape for `control` or `mark` (`../io-compat.ts`), so on
 * this deprecated door **both markers and resizes are dropped** on decode —
 * counted in `traceFromRecording`'s internal tally, but that tally has no
 * home on this function's `Recording`-shaped return, so a caller here still
 * can't see it (use `readAsciicast` + `traceFromRecording` directly for that).
 * That is the same fossil as before for markers, and a *new*, more accurate
 * one for resizes: pre-A3 this door miscategorized an `"r"` event as
 * directional input; now it drops it cleanly instead, alongside markers,
 * rather than mis-filing it. `Trace` also has no header fields for
 * `timestamp`/`title`/`env`/`theme`, so those are lost on decode exactly as
 * before (`title`/`timestamp` restorable via {@link EncodeAsciicastOptions}
 * at encode time; `env`/`theme` are not restorable through this door at all).
 * See `tests/asciicast/fixtures/README.md` for the measured detail.
 */

import { recordingFromTrace, traceFromRecording } from "../trace-bridges.ts"
import { readAsciicast, writeAsciicast } from "./io-codec.ts"
import { parseAsciicast } from "./reader.ts"
import type { Recording } from "../recording.ts"
import type { AsciicastRecording } from "./types.ts"

/** Options for {@link encodeAsciicast}. */
export interface EncodeAsciicastOptions {
  /** Optional `title` for the asciicast header. */
  title?: string
  /** Optional unix `timestamp` for the asciicast header. */
  timestamp?: number
}

/**
 * @deprecated Use {@link "./io-codec.ts" | readAsciicast} — this wrapper
 * composes it with `traceFromRecording` (`../trace-bridges.ts`) for callers
 * still on the `Trace`-shaped `Recording`. Every `output`/`input` event
 * becomes a direction-tagged `IoEvent`; `mark` and `control` events (which
 * includes the `"r"` resize code, unterm phase A3) have no `io`-track row
 * shape and are dropped — see this file's header for the full account.
 *
 * @throws {Error} when every event is `mark`/`control`/`exit` and none
 * survive into the `io` track (`traceFromRecording`'s "no survivors" guard) —
 * the same failure as before (a `.cast` with no byte events can't populate an
 * `io` track), reachable by a wider set of inputs now that resize is also a
 * non-surviving type, not just marker.
 */
export function decodeAsciicast(cast: AsciicastRecording): Recording {
  return traceFromRecording(readAsciicast(cast)).trace
}

/** Convenience: parse `.cast` text and decode it into a {@link Recording}. */
export function decodeAsciicastSource(content: string): Recording {
  return decodeAsciicast(parseAsciicast(content))
}

/**
 * @deprecated Use {@link "./io-codec.ts" | writeAsciicast} — this wrapper
 * composes it with `recordingFromTrace` (`../trace-bridges.ts`) for callers
 * still on the `Trace`-shaped `Recording`.
 *
 * @throws {Error} when the recording has no non-empty `io` track
 * (`recordingFromTrace`'s guard) — `.cast` is a serialization of observed
 * bytes, and a recording with only `commands` (a hand-authored tape) has no
 * byte stream to encode. Use the `.tape` codegen for an intent-only
 * recording.
 */
export function encodeAsciicast(recording: Recording, options?: EncodeAsciicastOptions): string {
  return writeAsciicast(recordingFromTrace(recording), options).text
}
