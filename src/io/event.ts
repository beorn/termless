/**
 * Event — everything that happens, in one causal order.
 *
 * One vocabulary, several containers: the same Event rows travel a live
 * session, a wire frame and a recording file. Full words in code; the single
 * letters (`o`/`i`/`m`) exist only inside a codec, never here.
 *
 * The union is discriminated on `type`. `at` is the event's position on the
 * session's monotonic µs clock ({@link Micros}).
 */

import type { Micros } from "./time.ts"
import type { Mode, Size } from "./picture.ts"

/**
 * Raw bytes on the wire.
 *
 * An Event always carries `Uint8Array` — one canonical form, so no reader has
 * to ask which encoding it got. String payloads (asciicast, `.tape`,
 * `node-pty`) are encoded at the codec door; the write door
 * ({@link "./session.ts" | InputChannel.write}) accepts a string for
 * ergonomics and encodes before the event exists.
 */
export type Bytes = Uint8Array

/** Bytes the program wrote — what you read. */
export interface OutputEvent {
  at: Micros
  type: "output"
  data: Bytes
}

/** Bytes written to the program — keys, paste, anything you send. */
export interface InputEvent {
  at: Micros
  type: "input"
  data: Bytes
}

/** The terminal was resized. */
export interface ResizeControlEvent {
  at: Micros
  type: "control"
  control: "resize"
  size: Size
}

/** A terminal mode was turned on or off. */
export interface ModeControlEvent {
  at: Micros
  type: "control"
  control: "mode"
  mode: Mode
  enabled: boolean
}

/** A signal was delivered to the program (`"SIGINT"`, `"SIGWINCH"`, …). */
export interface SignalControlEvent {
  at: Micros
  type: "control"
  control: "signal"
  signal: string
}

/**
 * The typed non-byte channel — resize, mode, signal.
 *
 * Discriminated a second time on `control`, so `type` stays the one
 * ecosystem-wide discriminant and the three control shapes stay distinguishable
 * without a second top-level type.
 */
export type ControlEvent = ResizeControlEvent | ModeControlEvent | SignalControlEvent

/**
 * A boundary worth naming — a turn end, an OSC 133 prompt, a chapter in a
 * recording. `name` is optional: an unnamed mark is still a seekable position.
 */
export interface MarkEvent {
  at: Micros
  type: "mark"
  name?: string
}

/**
 * The program ended.
 *
 * Recording sinks finalize on this event — without it a sink cannot tell a
 * finished session from a stalled one. Exactly one of `code`/`signal` is
 * normally non-null; both keys are always present, so a reader never has to
 * distinguish "absent" from "null".
 */
export interface ExitEvent {
  at: Micros
  type: "exit"
  code: number | null
  signal: string | null
}

/** Everything that happens, as one discriminated union. */
export type Event = OutputEvent | InputEvent | ControlEvent | MarkEvent | ExitEvent

/** How a program ended — the value {@link "./session.ts" | Session.exited} resolves to. */
export interface Exit {
  code: number | null
  signal: string | null
}

/** Every `Event["type"]`, in declaration order — the exhaustive event vocabulary. */
export const EVENT_TYPES: readonly Event["type"][] = ["output", "input", "control", "mark", "exit"]
