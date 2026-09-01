/**
 * The io timebase — integer microseconds on a single monotonic clock.
 *
 * Every `at` on every {@link "./event.ts" | Event} is a {@link Micros}. There
 * is one clock and one unit; a float second or a millisecond is normalized at
 * the door by {@link secondsToMicros} / {@link millisToMicros} and never
 * survives into the model.
 *
 * This module is the origin of the timebase. `recording/recording.ts`
 * re-exports it so the existing `Recording` model keeps its imports working;
 * there is exactly one `Micros` brand in the package.
 */

/**
 * A timestamp on the io monotonic clock.
 *
 * **Integer microseconds** relative to the start of the session or recording.
 * A branded `number`: the brand exists only at the type level (erased at
 * runtime) and forces every timestamp through {@link micros} or one of the
 * normalizers, so a stray float can never be assigned where µs are expected.
 */
export type Micros = number & { readonly __brand: "Micros" }

/**
 * Brand a raw integer as a {@link Micros} timestamp.
 *
 * Throws if the value is not a non-negative integer — the model never carries
 * a float timestamp, and this is the choke point that enforces it.
 */
export function micros(value: number): Micros {
  if (!Number.isInteger(value)) {
    throw new Error(`Recording timestamps must be integer microseconds, got: ${value}`)
  }
  if (value < 0) {
    throw new Error(`Recording timestamps must be non-negative, got: ${value}`)
  }
  return value as Micros
}

/**
 * Normalize an asciicast-style float-second timestamp to integer µs.
 *
 * asciicast v2 records `time` as a float in seconds; this is the import
 * normalizer that converts it to the integer-µs timebase. Rounds to the
 * nearest microsecond — there is no float left afterwards.
 */
export function secondsToMicros(seconds: number): Micros {
  return micros(Math.round(seconds * 1_000_000))
}

/**
 * Normalize a millisecond timestamp (e.g. `.tape` `Sleep` durations, wall
 * clocks) to integer µs.
 */
export function millisToMicros(ms: number): Micros {
  return micros(Math.round(ms * 1_000))
}
