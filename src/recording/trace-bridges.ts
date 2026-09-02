/**
 * Bridges between the multi-track `Trace` container (`./recording.ts`) and
 * the io-shaped `Recording` — a header plus the Events, saved
 * (`@termless/core/io`, `src/io/recording.ts`).
 *
 * Built on the row-level bridges in `./io-compat.ts` (`eventFromIoEvent` /
 * `ioEventFromEvent`); this file is the Trace-level counterpart, one step up:
 * whole containers, not single rows.
 *
 * The dependency runs one way: this file points at `src/io/`, never the
 * reverse.
 *
 * Everything in this file is migration scaffolding.
 *
 * @deprecated REMOVING in unterm phase A4a, alongside the deprecated
 * `Recording` alias on `./recording.ts` — once the root barrel's `Recording`
 * is the io shape, there is no second container to bridge to.
 */

import { eventFromIoEvent, ioEventFromEvent } from "./io-compat.ts"
import { createTrace } from "./recording.ts"
import type { Command, Frame, RecordingProvenance, Trace } from "./recording.ts"
import type { Recording as IoRecording, RecordingHeader } from "../io/recording.ts"
import { micros } from "../io/time.ts"

/**
 * Convert a {@link Trace}'s `io` track into an io-shaped {@link IoRecording}.
 *
 * Total on every Trace that carries a non-empty `io` track: each row goes
 * through {@link eventFromIoEvent} in stored order, so ordering and content
 * are preserved exactly. `commands` and `frames` have no home in the io
 * shape — this function speaks only the `io` track's truth.
 *
 * @throws {Error} when the Trace carries no non-empty `io` track. Naming
 * which tracks the Trace *does* have — never a silently empty Recording,
 * because there is no way to build an `IoRecording` without at least one
 * `output`/`input` event.
 */
export function recordingFromTrace(trace: Trace): IoRecording {
  if (trace.io === undefined || trace.io.length === 0) {
    const present: string[] = []
    if (trace.commands !== undefined && trace.commands.length > 0) present.push("commands")
    if (trace.frames !== undefined && trace.frames.length > 0) present.push("frames")
    throw new Error(
      `recordingFromTrace: Trace has no io track to convert (tracks present: ${
        present.length > 0 ? present.join(", ") : "none"
      })`,
    )
  }
  const header: RecordingHeader = {
    version: 1,
    size: { cols: trace.cols, rows: trace.rows },
    duration: trace.durationMicros,
    sourceResolution: "us",
  }
  return {
    header,
    events: trace.io.map(eventFromIoEvent),
  }
}

/** Tally of {@link IoRecording} events that have no `io`-track row shape. */
export interface DroppedEventTally {
  control: number
  mark: number
  exit: number
}

/** Extra Trace members {@link traceFromRecording} has no other source for. */
export interface TraceFromRecordingExtras {
  commands?: Command[]
  frames?: Frame[]
  provenance?: RecordingProvenance
}

/** Result of {@link traceFromRecording}: the built Trace plus its drop tally. */
export interface TraceFromRecordingResult {
  trace: Trace
  dropped: DroppedEventTally
}

/**
 * Convert an io-shaped {@link IoRecording} into a {@link Trace} carrying an
 * `io` track.
 *
 * Each event goes through {@link ioEventFromEvent}; events with no `io`-track
 * row shape (`control`, `mark`, `exit`) are counted in the returned `dropped`
 * tally rather than silently disappearing — the caller decides what, if
 * anything, to do about the gap. `cols`/`rows` come from the header's `size`;
 * `durationMicros` prefers the header's `duration`, falling back to the last
 * event's `at`, falling back to `micros(0)` when the Recording carries no
 * events at all.
 *
 * @param extras — `commands` / `frames` / `provenance` to attach to the
 * built Trace. The io shape has no room for these, so a caller reconstructing
 * a full Trace from other evidence passes them here.
 * @throws {Error} when no event survives conversion into an `io` row (i.e.
 * every event was `control`/`mark`/`exit`) — quoting the tally, since an
 * all-dropped conversion is exactly the case a silent empty Trace would hide.
 */
export function traceFromRecording(
  recording: IoRecording,
  extras?: TraceFromRecordingExtras,
): TraceFromRecordingResult {
  const io: NonNullable<Trace["io"]> = []
  const dropped: DroppedEventTally = { control: 0, mark: 0, exit: 0 }
  for (const event of recording.events) {
    const row = ioEventFromEvent(event)
    if (row === null) {
      dropped[event.type as "control" | "mark" | "exit"] += 1
    } else {
      io.push(row)
    }
  }
  if (io.length === 0) {
    throw new Error(
      `traceFromRecording: no output/input events survived conversion ` +
        `(dropped: control=${dropped.control}, mark=${dropped.mark}, exit=${dropped.exit})`,
    )
  }
  const lastEventAt = recording.events.length > 0 ? recording.events[recording.events.length - 1]?.at : undefined
  const durationMicros = recording.header.duration ?? lastEventAt ?? micros(0)

  const trace = createTrace({
    cols: recording.header.size.cols,
    rows: recording.header.size.rows,
    durationMicros,
    io,
    commands: extras?.commands,
    frames: extras?.frames,
    provenance: extras?.provenance,
  })

  return { trace, dropped }
}
