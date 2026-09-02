/**
 * Transforms — pure functions over a Recording: trim, retime, filter.
 *
 * Each takes a {@link Recording} and returns a new one. The input is never
 * mutated: a fresh header and a fresh events array come back every time, and
 * an event object is reused unless its `at` changes — an event the transform
 * left alone survives it by reference (`===`), not only by value. All three
 * share one shape, `(Recording, ...) => Recording`, so they compose:
 *
 * ```ts
 * retime(trim(recording, { from, to }), { speed })
 * ```
 *
 * These are the three transforms the unterm design names for a recording
 * (trim, re-time, filter); they live beside the io types until the recording
 * half moves out on its own.
 */

import type { Event } from "./event.ts"
import type { Recording, RecordingHeader } from "./recording.ts"
import { micros, type Micros } from "./time.ts"

/** Copy an event with a new `at`, or return it unchanged when `at` is the same. */
function withAt(event: Event, at: Micros): Event {
  return event.at === at ? event : ({ ...event, at } as Event)
}

/**
 * Keep only the events within `[from, to]` (inclusive) and shift them so the
 * window starts at 0.
 *
 * `from` defaults to 0; `to` defaults to `header.duration` when present, else
 * the last event's `at` (0 for an empty recording with no duration). The
 * returned header's `duration` is always set —
 * `min(to, duration ?? lastAt) - from` — even when the input had none,
 * because a trimmed slice is a bounded recording by definition. A `to` past
 * the real end is *clamped* down to it; an inverted window (`to < from`) or a
 * negative bound is never silently clamped — it throws, naming the offending
 * values, so a caller's bug never disguises itself as an empty-looking trim.
 */
export function trim(recording: Recording, window: { from?: Micros; to?: Micros } = {}): Recording {
  const { header, events } = recording
  const from = window.from ?? micros(0)
  if (from < 0) {
    throw new RangeError(`trim: from must be non-negative, got ${from}`)
  }

  const lastAt = events.length > 0 ? events[events.length - 1]!.at : micros(0)
  const effectiveEnd = header.duration ?? lastAt
  const to = window.to ?? effectiveEnd
  if (to < 0) {
    throw new RangeError(`trim: to must be non-negative, got ${to}`)
  }
  if (to < from) {
    throw new RangeError(`trim: window is inverted — to (${to}) is before from (${from})`)
  }

  const kept = events.filter((e) => e.at >= from && e.at <= to)
  const shifted = kept.map((e) => withAt(e, micros(e.at - from)))
  const duration = micros(Math.min(to, effectiveEnd) - from)

  return { header: { ...header, duration }, events: shifted }
}

/**
 * Rescale the timeline by the gaps between consecutive events, not by scaling
 * `at` values directly — so a `maxGap` cap (e.g. "no silence longer than 2s")
 * only ever shortens dead air, never compresses the events around it.
 *
 * The first event's offset from 0 counts as a gap. Each gap is capped at
 * `maxGap` when given, then divided by `speed` (default 1; must be > 0, or
 * this throws naming the value). `at` values are `micros(Math.round(...))` of
 * the running, unrounded cumulative time, so the sequence is monotone
 * non-decreasing by construction: every transformed gap is >= 0, and
 * `Math.round` is order-preserving, so rounding cannot un-order an
 * already-ordered sequence. When `header.duration` is present, the tail gap
 * (`duration - lastAt`) gets the same treatment so the header stays
 * consistent with the last event; when it is absent it stays absent — retime
 * only rescales what is already there, it never fabricates the bound `trim`
 * derives.
 */
export function retime(recording: Recording, opts: { speed?: number; maxGap?: Micros } = {}): Recording {
  const speed = opts.speed ?? 1
  if (!(speed > 0)) {
    throw new RangeError(`retime: speed must be > 0, got ${speed}`)
  }
  const cap = (gap: number): number => (opts.maxGap !== undefined ? Math.min(gap, opts.maxGap) : gap)

  let originalAt = 0
  let cursor = 0
  const events = recording.events.map((event) => {
    cursor += cap(event.at - originalAt) / speed
    originalAt = event.at
    return withAt(event, micros(Math.round(cursor)))
  })

  const header: RecordingHeader = { ...recording.header }
  if (header.duration !== undefined) {
    cursor += cap(header.duration - originalAt) / speed
    header.duration = micros(Math.round(cursor))
  }

  return { header, events }
}

/**
 * Keep only the events for which `keep` returns true.
 *
 * The header is copied as-is: filtering removes rows, it never re-times.
 * Dropping an event does not change when anything else happened, so unlike
 * `trim` there is no window to derive a new `duration` from — compose with
 * `retime` when the removed events' time should also collapse.
 */
export function filter(recording: Recording, keep: (event: Event) => boolean): Recording {
  return { header: { ...recording.header }, events: recording.events.filter(keep) }
}

/**
 * A `filter` predicate that keeps events of the given types — typed against
 * the `Event["type"]` discriminant so a misspelled type name is a compile
 * error, not a predicate that silently matches nothing.
 */
export function byType(...types: Event["type"][]): (event: Event) => boolean {
  return (event: Event): boolean => types.includes(event.type)
}
