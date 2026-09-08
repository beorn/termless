/**
 * PTY module for termless.
 *
 * Spawns a child process with a pseudo-terminal and bridges its I/O to a
 * TerminalBackend via callbacks. Works on both Bun (native PTY) and Node.js
 * (via node-pty optional peer dependency).
 */

import { spawnPortablePty, type PortablePtyProcess } from "./spawn.ts"
import type { Size } from "../io/picture.ts"
import type { SpawnOptions } from "../io/session.ts"

// ── Types ──

/**
 * A handle on a running PTY.
 *
 * @deprecated REMOVING in unterm phase A4 — replaced by `Session`
 * (`@termless/core/io`). Not a true alias, and the difference is the point:
 * `Session` reads its output through `events()` instead of the `onData`
 * callback below, spells writes as `input.write`, resize as
 * `control.resize`, and replaces the `alive`/`exitInfo` string pair with
 * `exited: Promise<Exit>` plus an `exit` Event a recording sink can finalize
 * on.
 */
export interface PtyHandle {
  /** Write raw data to the PTY (forwarded to the child process stdin). */
  write(data: string): void
  /** Resize the PTY dimensions. */
  resize(cols: number, rows: number): void
  /** Whether the child process is still running. */
  readonly alive: boolean
  /** Exit info string (e.g., "exit=0") when process has exited, null otherwise. */
  readonly exitInfo: string | null
  /** Gracefully close the PTY: SIGTERM, wait 2s, SIGKILL if needed. */
  close(): Promise<void>
}

/**
 * The pre-`events()` output door: everything a spawned Session needs, with the
 * size flattened to `cols`/`rows` and output delivered by callback.
 *
 * @deprecated REMOVING in unterm phase A4 — use `SpawnOptions` from
 * `@termless/core/io` and read output from `Session.events()`. A true alias
 * for the option half: the shape is derived from the io type rather than
 * restated. Only `onData` is additive, and it is exactly what `events()`
 * replaces.
 */
export type PtySpawnOptions = Omit<SpawnOptions, "size"> &
  Size & {
    /** Callback invoked when the child process writes output data. */
    onData: (data: Uint8Array) => void
  }

/**
 * As {@link PtySpawnOptions}, but the program is a shell command string run
 * via `bash -c` rather than a direct argv.
 *
 * @deprecated REMOVING in unterm phase A4 — use `SpawnOptions` from
 * `@termless/core/io`. A true alias for the shared half: derived from the io
 * type with `command` swapped for `shellCommand`.
 */
export type PtyShellOptions = Omit<SpawnOptions, "size" | "command"> &
  Size & {
    /** Shell command string to execute via `bash -c`. Use when you need shell features (pipes, globbing, etc.). */
    shellCommand: string
    /** Callback invoked when the child process writes output data. */
    onData: (data: Uint8Array) => void
  }

// ── Implementation ──

/**
 * Spawn a child process with a PTY and return a handle for interacting with it.
 *
 * The command is spawned directly (no shell wrapper) to avoid shell injection.
 *
 * ## The colour palette is a DEFAULT — it fills in, it never overrides
 *
 * Three inputs decide the child's palette, in this order:
 *
 * 1. the caller's explicit `env` argument, which beats everything;
 * 2. an ambient `FORCE_COLOR` or `NO_COLOR` in the environment, which beats the
 *    defaults — an environment that already answered is not asked again, and an
 *    EMPTY value is an answer (the detector reads any defined value as set);
 * 3. these defaults, `FORCE_COLOR=3` and `TERM=xterm-256color`, for whatever
 *    nobody set. `3` is truecolor: an instrument built to CAPTURE colour wants
 *    the widest palette, so a finding taken through it is about the application
 *    and never about the tier.
 *
 * **It used to be the other way round, and the reversal was silent.** Until
 * 2026-09-08 both values were written unconditionally, so a hardcoded
 * `FORCE_COLOR=1` — the SIXTEEN-colour tier, not "colour enabled" — overwrote
 * the ambient environment AND the `xterm-256color` beside it, leaving every
 * hosted app below the tier a bare `TERM` would have given it. A test that
 * stubbed `FORCE_COLOR` watched its stub be discarded for the child.
 *
 * **What that cost, so the shape is recognisable if it recurs:** a Nord palette
 * quantised to 16 slots collapses — `#81a1c1` (blue) to `#c0c0c0`, `#bf616a`
 * (error red) to `#808080`, the same grey as muted text, and the `#2e3440`
 * ground to pure black. Two display defects were measured, reported and ruled
 * on from such a capture; both were withdrawn and the component was correct.
 * **A capture showing a black ground with greys of 128 and 192 is a palette
 * signature, not a finding about the application.**
 *
 * To take a deliberately narrow capture, say so at the spawn site:
 *
 * ```ts
 * spawnPty({ command, cols, rows, env: { FORCE_COLOR: "1" } })  // 16 colours
 * ```
 *
 * `tests/pty.pty.test.ts` pins all three levels of that ordering.
 *
 * Runtime support:
 * - Bun: uses native `Bun.spawn()` with `terminal` option (built-in PTY)
 * - Node.js: uses `node-pty` (must be installed as a peer dependency)
 */
/**
 * The palette this instrument supplies to a child — as DEFAULTS, which fill in
 * what the environment does not say and never override what it does.
 *
 * Ordering, and every step of it was once wrong: the caller's explicit `env`
 * beats everything (it is spread after these); an ambient value beats these;
 * and these apply only to what nobody set. `NO_COLOR` counts as an answer, so a
 * palette is not injected over it.
 *
 * `FORCE_COLOR=3` is truecolor, chosen because an instrument built to CAPTURE
 * colour wants the widest palette by default — a finding taken through it
 * should be about the application, never about the tier. The previous value was
 * `1`, which means SIXTEEN colours rather than "colour on", and it was written
 * unconditionally.
 */
function paletteDefaults(): Record<string, string> {
  const defaults: Record<string, string> = {}
  // A caller who wants a narrower palette says so at the spawn site; an
  // environment that already answered is not asked again.
  if (process.env.FORCE_COLOR === undefined && process.env.NO_COLOR === undefined) {
    defaults.FORCE_COLOR = "3"
  }
  if (process.env.TERM === undefined) defaults.TERM = "xterm-256color"
  return defaults
}

export function spawnPty(options: PtySpawnOptions | PtyShellOptions): PtyHandle {
  const { env, cwd, cols, rows, onData } = options

  // Determine the argv: direct command or shell-wrapped
  const argv = "shellCommand" in options ? ["bash", "-c", options.shellCommand] : options.command

  const proc: PortablePtyProcess = spawnPortablePty({
    argv,
    cols,
    rows,
    cwd,
    env: {
      ...paletteDefaults(),
      ...env,
    },
    onData,
  })

  let closed = false
  let exitCode: number | null = null

  // Track exit code (fire-and-forget)
  void (async () => {
    try {
      exitCode = await proc.exited
    } catch {
      // Process may have been killed before exit
    }
  })()

  async function close(): Promise<void> {
    if (closed) return
    closed = true

    // Close PTY write channel
    proc.closePty()

    // SIGTERM, then wait up to 2s, then SIGKILL
    try {
      proc.kill()
      const exited = await Promise.race([
        proc.exited.then(() => true as const),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 2000)),
      ])
      if (!exited) {
        proc.kill(9) // SIGKILL
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  return {
    write(data: string): void {
      if (closed) throw new Error("PTY is closed")
      proc.write(data)
    },

    resize(newCols: number, newRows: number): void {
      if (closed) throw new Error("PTY is closed")
      proc.resize(newCols, newRows)
    },

    get alive(): boolean {
      return !closed && exitCode === null
    },

    get exitInfo(): string | null {
      if (exitCode !== null) return `exit=${exitCode}`
      return null
    },

    close,
  }
}
