/**
 * `Recording` → `.tape` codegen — **best-effort and lossy**.
 *
 * This is the inverse of {@link "./compile.ts"}, but `.tape` is a *compiler
 * input*, not a symmetric codec (design doc §4): the round-trip
 * `.tape → Recording → .tape` is **lossy by nature**, and so is
 * `Recording → .tape` from a recording that originated elsewhere.
 *
 * What this module can and cannot do:
 *
 *  - It serializes the `commands` track only. A recording with no `commands`
 *    track (a decoded `.cast`, an io-only capture) has *no* intent to render
 *    as a `.tape` — {@link generateTape} throws for it.
 *  - The `io` and `frames` members are dropped — `.tape` has no syntax for raw
 *    bytes or rendered frames.
 *  - Timing is not perfectly preserved: `.tape` expresses cadence through
 *    `Sleep` directives and `Type@speed`, not absolute timestamps. The
 *    generated tape inserts a `Sleep` whenever the gap between two commands
 *    exceeds a threshold, approximating — not reproducing — the original
 *    clock.
 *
 * Use it for *human-readable export* of an authored recording, never as a
 * lossless serialization. The native `.rec` format (Phase 5) is the lossless
 * round-trip.
 */

import type { Command, Recording } from "../recording.ts"

/** Options for {@link generateTape}. */
export interface GenerateTapeOptions {
  /** Emit a leading `Output <path>` directive. */
  output?: string
  /**
   * Emit `Set Width`/`Set Height` from the recording dimensions as the first
   * directives. Default: `true`.
   */
  emitDimensions?: boolean
  /**
   * Minimum gap (µs) between two commands before a `Sleep` is synthesized to
   * bridge it. Smaller gaps are treated as natural typing cadence and
   * dropped. Default: 250_000 (250ms).
   */
  sleepThresholdMicros?: number
}

const DEFAULT_SLEEP_THRESHOLD = 250_000

/** Quote a string for the `.tape` `Type "..."` / `Set k "v"` syntax. */
function quote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

/** Render a single {@link Command} as one or more `.tape` lines. */
function commandToLines(cmd: Command): string[] {
  switch (cmd.kind) {
    case "type": {
      if (cmd.speedMicros !== undefined) {
        const ms = Math.round(cmd.speedMicros / 1000)
        return [`Type@${ms}ms ${quote(cmd.text)}`]
      }
      return [`Type ${quote(cmd.text)}`]
    }
    case "key": {
      // VHS key directives are capitalized words; emit a count when > 1.
      return [cmd.count !== undefined && cmd.count > 1 ? `${cmd.key} ${cmd.count}` : cmd.key]
    }
    case "ctrl":
      return [`Ctrl+${cmd.key}`]
    case "alt":
      return [`Alt+${cmd.key}`]
    case "sleep": {
      const ms = Math.round(cmd.durationMicros / 1000)
      return [`Sleep ${ms}ms`]
    }
    case "resize":
      // A mid-tape resize lowers to two Set directives.
      return [`Set Width ${cmd.cols}`, `Set Height ${cmd.rows}`]
    case "set":
      return [`Set ${cmd.key} ${quote(cmd.value)}`]
    case "screenshot":
      return [cmd.path !== undefined ? `Screenshot ${cmd.path}` : "Screenshot"]
  }
}

/**
 * Generate best-effort `.tape` source text from a {@link Recording}.
 *
 * @throws {Error} when the recording carries no `commands` track — there is
 *   no intent to serialize.
 */
export function generateTape(recording: Recording, options?: GenerateTapeOptions): string {
  const commands = recording.commands
  if (commands === undefined || commands.length === 0) {
    throw new Error("generateTape: recording has no commands track — nothing to codegen as .tape")
  }
  const emitDimensions = options?.emitDimensions ?? true
  const sleepThreshold = options?.sleepThresholdMicros ?? DEFAULT_SLEEP_THRESHOLD

  const lines: string[] = []
  lines.push("# Generated from a termless Recording — lossy, best-effort.")
  if (options?.output !== undefined) lines.push(`Output ${options.output}`)
  if (emitDimensions) {
    lines.push(`Set Width ${recording.cols}`)
    lines.push(`Set Height ${recording.rows}`)
  }

  let prevAt: number | null = null
  for (const cmd of commands) {
    // Bridge a long gap with a synthesized Sleep. A `sleep` command already
    // carries its own duration, so don't double-count it.
    if (prevAt !== null && cmd.kind !== "sleep") {
      const gap = cmd.at - prevAt
      if (gap >= sleepThreshold) {
        lines.push(`Sleep ${Math.round(gap / 1000)}ms`)
      }
    }
    for (const line of commandToLines(cmd)) lines.push(line)
    prevAt = cmd.at
  }

  return lines.join("\n") + "\n"
}
