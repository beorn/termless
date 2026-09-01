/**
 * Adapters between the `io` track's byte rows and the io `Event` union.
 *
 * The dependency runs one way: this file points at `src/io/`, and `src/io/`
 * points at nothing.
 *
 * Everything in this file is migration scaffolding.
 *
 * @deprecated REMOVING in unterm phase A4 — phase A3 converges the Recording
 * model onto `Event[]`, after which there is no second row shape to convert.
 */

import type { Event, InputEvent, OutputEvent } from "../io/event.ts"
import type { IoEvent } from "./recording.ts"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Convert one `io`-track row to its {@link Event}.
 *
 * Total: every `IoEvent` has an Event, because `direction` maps exactly onto
 * the `output` / `input` types. The string payload is UTF-8 encoded — an
 * `Event` always carries bytes.
 */
export function eventFromIoEvent(row: IoEvent): OutputEvent | InputEvent {
  const data = encoder.encode(row.data)
  return row.direction === "out" ? { at: row.at, type: "output", data } : { at: row.at, type: "input", data }
}

/**
 * Convert one {@link Event} back to an `io`-track row, or `null` when the
 * track cannot carry it.
 *
 * **What returns `null`, and why:** the `io` track holds timed *bytes* and
 * nothing else, so `control`, `mark` and `exit` events have no row shape
 * there. That is a real gap in the old model, not a lookup miss — the caller
 * must decide what to do with the event rather than assume it was empty.
 * Phase A3 is where the Recording model grows the room and this function stops
 * being able to answer `null`.
 */
export function ioEventFromEvent(e: Event): IoEvent | null {
  switch (e.type) {
    case "output":
      return { at: e.at, direction: "out", data: decoder.decode(e.data) }
    case "input":
      return { at: e.at, direction: "in", data: decoder.decode(e.data) }
    case "control":
    case "mark":
    case "exit":
      return null
  }
}
