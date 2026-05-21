/**
 * `.tape` → `Recording` compiler.
 *
 * A `.tape` file is a *scenario script* — high-level directives (`Type`,
 * `Sleep`, `Screenshot`, …). This module is the **compiler** that lowers a
 * parsed `TapeFile` into the in-memory {@link Recording} model's `commands`
 * source track.
 *
 * It is deliberately **not a symmetric codec**: `.tape` carries intent,
 * `Recording.commands` carries the same intent in the unified shape, and the
 * inverse direction ({@link "./codegen.ts"}) is best-effort and lossy. The
 * design doc (§4) is explicit that `.tape` is a compiler input, not a peer of
 * `.cast`.
 *
 * Compilation model — the `commands` track is timed on the recording's
 * monotonic µs clock. The compiler walks the tape advancing a virtual clock:
 *
 *  - `Type` — emitted as a single `{ kind: "type" }` command at the current
 *    clock; the clock advances by `text.length × speed` (the per-character
 *    typing delay the executor would apply). `speedMicros` records the
 *    per-character delay so a player can reproduce the cadence.
 *  - `Enter`/`Backspace`/… — `{ kind: "key" }`; a `count` > 1 advances the
 *    clock by `count × 50ms` (mirroring the executor's inter-press delay).
 *  - `Ctrl+x` / `Alt+x` — `{ kind: "ctrl" }` / `{ kind: "alt" }`.
 *  - `Sleep` — `{ kind: "sleep" }`; advances the clock by the sleep duration.
 *  - `Set Width|Height` — `{ kind: "resize" }`; other `Set` keys → a
 *    `{ kind: "set" }` directive (environment change).
 *  - `Screenshot` — `{ kind: "screenshot" }`. A *render directive*, NOT a
 *    {@link Frame} — the design doc (§4) is explicit it must not collapse into
 *    the frames projection.
 *  - `Hide`/`Show`/`Output`/`Source`/`Require`/`Expect` — player/CLI
 *    directives with no place on the `commands` track; dropped, surfaced via
 *    {@link CompileTapeResult.dropped} so callers can warn.
 *
 * `Set Width`/`Set Height` also seed the recording's initial `cols`/`rows`.
 */

import { createTerminal } from "../terminal.ts"
import {
  type Command,
  type Micros,
  type Recording,
  createRecording,
  micros,
  millisToMicros,
} from "../recording-model.ts"
import { type TapeCommand, type TapeFile, parseTape } from "./parser.ts"

// =============================================================================
// Options + result
// =============================================================================

/** Options for {@link compileTape}. */
export interface CompileTapeOptions {
  /** Override terminal columns (else `Set Width`, else 80). */
  cols?: number
  /** Override terminal rows (else `Set Height`, else 24). */
  rows?: number
  /**
   * Default per-character typing delay in ms used to advance the virtual
   * clock for a `Type` with no explicit `@speed`. Mirrors the executor's
   * `defaultTypingSpeed` (default 50ms).
   */
  defaultTypingSpeedMs?: number
}

/** Result of {@link compileTape}. */
export interface CompileTapeResult {
  /** The compiled in-memory recording (carries a `commands` track). */
  recording: Recording
  /**
   * Tape commands with no representation on the `commands` track —
   * `Output`, `Hide`, `Show`, `Source`, `Require`, `Expect`. Surfaced so a
   * caller can warn that information was dropped; the compile itself never
   * fails on them.
   */
  dropped: TapeCommand[]
}

// =============================================================================
// Compiler
// =============================================================================

const DEFAULT_TYPING_SPEED_MS = 50
const INTER_PRESS_DELAY_MS = 50

/** Tape command `type` values that have no `commands`-track representation. */
const DROPPED_KINDS = new Set<TapeCommand["type"]>([
  "output",
  "hide",
  "show",
  "source",
  "require",
  "expect",
])

/**
 * Compile a parsed `.tape` into a {@link Recording} carrying a `commands`
 * source track.
 *
 * The result recording has `io` and `frames` undefined — a hand-authored
 * tape is intent-only. `provenance.reproducible` stays at its default
 * (`true`): the session's frames *could* be derived by playing the commands.
 */
export function compileTape(tape: TapeFile, options?: CompileTapeOptions): CompileTapeResult {
  const settingWidth = tape.settings.Width ? Number.parseInt(tape.settings.Width, 10) : undefined
  const settingHeight = tape.settings.Height ? Number.parseInt(tape.settings.Height, 10) : undefined
  let cols = options?.cols ?? settingWidth ?? 80
  let rows = options?.rows ?? settingHeight ?? 24

  const defaultSpeedMs = options?.defaultTypingSpeedMs ?? DEFAULT_TYPING_SPEED_MS

  const commands: Command[] = []
  const dropped: TapeCommand[] = []
  // Virtual clock in microseconds, advancing as the tape "executes".
  let clockMicros = 0

  const at = (): Micros => micros(clockMicros)

  for (const cmd of tape.commands) {
    if (DROPPED_KINDS.has(cmd.type)) {
      dropped.push(cmd)
      continue
    }
    switch (cmd.type) {
      case "set": {
        if (cmd.key === "Width") {
          cols = Number.parseInt(cmd.value, 10) || cols
          commands.push({ kind: "resize", at: at(), cols, rows })
        } else if (cmd.key === "Height") {
          rows = Number.parseInt(cmd.value, 10) || rows
          commands.push({ kind: "resize", at: at(), cols, rows })
        } else {
          commands.push({ kind: "set", at: at(), key: cmd.key, value: cmd.value })
        }
        break
      }
      case "type": {
        // The clock advances by the *effective* typing speed (explicit
        // `@speed` or the default). `speedMicros` is recorded ONLY when the
        // tape authored an explicit `@speed` — the default cadence is not
        // intent, so it must not survive `Recording → .tape` codegen.
        const effectiveSpeedMs = cmd.speed ?? defaultSpeedMs
        commands.push(
          cmd.speed !== undefined
            ? { kind: "type", at: at(), text: cmd.text, speedMicros: millisToMicros(cmd.speed) }
            : { kind: "type", at: at(), text: cmd.text },
        )
        clockMicros += effectiveSpeedMs * cmd.text.length * 1000
        break
      }
      case "key": {
        const count = cmd.count ?? 1
        commands.push(count > 1 ? { kind: "key", at: at(), key: cmd.key, count } : { kind: "key", at: at(), key: cmd.key })
        if (count > 1) clockMicros += INTER_PRESS_DELAY_MS * (count - 1) * 1000
        break
      }
      case "ctrl":
        commands.push({ kind: "ctrl", at: at(), key: cmd.key })
        break
      case "alt":
        commands.push({ kind: "alt", at: at(), key: cmd.key })
        break
      case "sleep": {
        const durationMicros = millisToMicros(cmd.ms)
        commands.push({ kind: "sleep", at: at(), durationMicros })
        clockMicros += cmd.ms * 1000
        break
      }
      case "screenshot":
        commands.push(cmd.path !== undefined ? { kind: "screenshot", at: at(), path: cmd.path } : { kind: "screenshot", at: at() })
        break
    }
  }

  // A tape with no compilable command still produces a valid (empty-intent)
  // recording is impossible — createRecording rejects an all-empty Recording.
  // Seed a zero-duration sleep so a fully-dropped tape still yields a
  // Recording rather than throwing; this keeps `compileTape` total.
  if (commands.length === 0) {
    commands.push({ kind: "sleep", at: micros(0), durationMicros: micros(0) })
  }

  const recording = createRecording({
    cols,
    rows,
    durationMicros: micros(clockMicros),
    commands,
  })
  return { recording, dropped }
}

/** Convenience: parse `.tape` source text and compile it in one call. */
export function compileTapeSource(source: string, options?: CompileTapeOptions): CompileTapeResult {
  return compileTape(parseTape(source), options)
}

/**
 * Construct a live {@link Terminal} sized to a compiled recording.
 *
 * A small convenience for `play`-style consumers — the `commands` track has
 * no opinion about the backend, so the caller still passes one in.
 */
export function terminalForRecording(
  recording: Recording,
  backend: Parameters<typeof createTerminal>[0]["backend"],
): ReturnType<typeof createTerminal> {
  return createTerminal({ backend, cols: recording.cols, rows: recording.rows })
}
