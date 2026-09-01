/**
 * Session — a live terminal you talk to.
 *
 * Spawned, attached, wrapped or replayed: a Session is the same contract in
 * every case. A replay is nobody's child, which is why this is a *session* and
 * not a *child process*.
 *
 * **`events()` is THE primitive.** It is the single causal order of everything
 * that happened. `output`, `input` and `control` are *filtered views* of that
 * one stream — never a second truth, never a different order. A conformance
 * check that walks a member alongside `events()` must see the same rows in the
 * same sequence.
 */

import type { ControlEvent, Event, Exit, InputEvent, OutputEvent } from "./event.ts"
import type { Mode, Size } from "./picture.ts"

/**
 * A stream of Events — anything you can `for await` over.
 *
 * An alias, not a concept: `spawn()`, `attach()`, `wrap()` and `replay()` all
 * produce one, and {@link "./pipe.ts" | pipe} consumes one.
 */
export type Source = AsyncIterable<Event>

/**
 * Anything that can be fed an Event.
 *
 * An alias, not a concept: every emulator is a Sink, and so are `record(file)`
 * and `send(stream)`. `apply` may return a Promise; {@link "./pipe.ts" | pipe}
 * awaits it, which is what makes the pull side set the pace.
 */
export interface Sink {
  apply(e: Event): void | Promise<void>
}

/**
 * Bytes the program writes — a filtered view of {@link Session.events}
 * carrying only `output` rows.
 */
export type OutputChannel = AsyncIterable<OutputEvent>

/**
 * Bytes you write to the program, and a view of what was written.
 *
 * `write` accepts a string for ergonomics (`session.input.write("ls\r")`) and
 * encodes it before the `input` Event exists — the Event itself always carries
 * `Uint8Array`.
 */
export interface InputChannel extends AsyncIterable<InputEvent> {
  write(data: Uint8Array | string): void | Promise<void>
}

/**
 * The typed non-byte channel — resize, modes, signals.
 *
 * Optional on a Session: a plain pipe has no control channel at all, and an
 * attached remote has one only if the far side negotiated it.
 */
export interface ControlChannel extends AsyncIterable<ControlEvent> {
  resize(size: Size): void | Promise<void>
  setMode(mode: Mode, enabled: boolean): void | Promise<void>
  signal(signal: string): void | Promise<void>
}

/** A live terminal you talk to — spawned, attached, wrapped or replayed. */
export interface Session {
  /** Bytes the program writes. A filtered view of {@link Session.events}. */
  readonly output: OutputChannel
  /** Bytes you write to the program. A filtered view of {@link Session.events}. */
  readonly input: InputChannel
  /**
   * Resize, modes, signals. Absent when the transport has no typed channel —
   * a plain pipe, or a remote that did not negotiate one.
   */
  readonly control?: ControlChannel
  /**
   * THE primitive: everything that happened, one stream, causal order. The
   * members above are filtered views of this.
   */
  events(): AsyncIterable<Event>
  /** The terminal's current geometry. */
  readonly size: Size
  /** Resolves when the program ends. */
  readonly exited: Promise<Exit>
}

/**
 * What a spawned Session needs to start a program.
 *
 * `terminal/types.ts`'s legacy `SpawnOptions` is exactly this minus `size`,
 * and `pty.ts`'s `PtySpawnOptions` is exactly this flattened with the
 * pre-`events()` `onData` callback — both are expressed as aliases over this
 * shape rather than restated.
 */
export interface SpawnOptions {
  /** Command to execute as `[program, ...args]`. Spawned directly, without a shell. */
  command: string[]
  /** Additional environment variables (merged with the parent environment). */
  env?: Record<string, string>
  /** Working directory for the child process. */
  cwd?: string
  /** Terminal geometry the program starts with. */
  size: Size
}
