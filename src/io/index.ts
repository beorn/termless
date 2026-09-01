/**
 * The io primitives — four types, one function, two bridges.
 *
 * ```
 * A Session is a live terminal you talk to — spawned, attached, wrapped or replayed.
 * Everything that happens is one Event — full words in code, letters only in codecs.
 * An Emulator eats Events and shows you the picture.
 * A Recording is a header plus the Events, saved.
 *
 * Source = AsyncIterable<Event>   ·   Sink = { apply(e): void | Promise<void> }
 * pipe(source, ...sinks)          awaits each apply — backpressure is the pull side doing its job
 * ```
 *
 * **This module depends on nothing.** Everything else in the package points at
 * it; it points at no package, no emulator, no React. That law is what lets it
 * become a standalone package later without a single import moving the wrong
 * way.
 *
 * Reached as `@termless/core/io`. It is not folded into the root barrel: the
 * root barrel already exports a different `Recording` (the multi-track model
 * that today's codecs read) and a bare `Event` there would shadow the DOM
 * global for every consumer. Both resolve when phase A3 converges the
 * Recording models.
 *
 * @example
 * ```ts
 * import { pipe, type Event, type Emulator } from "@termless/core/io"
 *
 * await pipe(session.events(), emulator, record(file))
 * ```
 */

// ── Event — everything that happens ──
export type {
  Bytes,
  ControlEvent,
  Event,
  Exit,
  ExitEvent,
  InputEvent,
  MarkEvent,
  ModeControlEvent,
  OutputEvent,
  ResizeControlEvent,
  SignalControlEvent,
} from "./event.ts"
export { EVENT_TYPES } from "./event.ts"

// ── Session — a live terminal you talk to ──
export type { ControlChannel, InputChannel, OutputChannel, Session, Sink, Source, SpawnOptions } from "./session.ts"

// ── Emulator — eats Events, shows the picture ──
export type { Emulator } from "./emulator.ts"

// ── Recording — a header plus the Events, saved ──
export type { Recording, RecordingHeader } from "./recording.ts"

// ── The readable picture ──
export type { Cell, Color, Cursor, CursorStyle, Mode, Modes, Size, UnderlineStyle } from "./picture.ts"
export { MODES } from "./picture.ts"

// ── The timebase — integer microseconds, one monotonic clock ──
export type { Micros } from "./time.ts"
export { micros, millisToMicros, secondsToMicros } from "./time.ts"

// ── pipe + the Web Streams bridges ──
export { fromReadable, pipe, toReadable } from "./pipe.ts"
