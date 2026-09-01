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
 * Sets FORCE_COLOR=1 and TERM=xterm-256color to ensure proper color output.
 *
 * Runtime support:
 * - Bun: uses native `Bun.spawn()` with `terminal` option (built-in PTY)
 * - Node.js: uses `node-pty` (must be installed as a peer dependency)
 */
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
      FORCE_COLOR: "1",
      TERM: "xterm-256color",
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
