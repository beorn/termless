/**
 * PTY module for termless.
 *
 * Spawns a child process with a pseudo-terminal and bridges its I/O to a
 * TerminalBackend via callbacks. Works on both Bun (native PTY) and Node.js
 * (via node-pty optional peer dependency).
 */

import { readFileSync } from "node:fs"
import { basename } from "node:path"
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
  /** Gracefully close the PTY: SIGTERM, then SIGHUP after a grace, then SIGKILL if needed. */
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

/** Linux exposes ignored signals on the child; `null` means the fact is unavailable. */
function ignoresSigterm(pid: number): boolean | null {
  if (process.platform !== "linux") return null
  const statusPath = `/proc/${pid}/status`
  try {
    const mask = /^SigIgn:\s*([0-9a-f]+)\s*$/im.exec(readFileSync(statusPath, "utf8"))?.[1]
    if (mask !== undefined) return (BigInt(`0x${mask}`) & (1n << 14n)) !== 0n
    process.emitWarning(`${statusPath} has no SigIgn fact; retaining the full TERM grace`, "TermlessSignalProbe")
    return null
  } catch (error) {
    // ENOENT is an ordinary race with child exit. Other failures are reported;
    // the fallback keeps the full TERM grace unless argv names a shell.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      process.emitWarning(
        `cannot read ${statusPath}; retaining the full TERM grace: ${String(error)}`,
        "TermlessSignalProbe",
      )
    }
    // silent-fallback-allow: ENOENT is the ordinary race with child exit; any other read failure is warned above, and null keeps the full TERM grace
    return null
  }
}

/** Fallback for platforms without /proc; never classify `bash -c <script>` as interactive. */
function isInteractiveShell(argv: readonly string[]): boolean {
  const shell = basename(argv[0] ?? "")
  if (!["bash", "zsh", "fish", "sh", "ksh", "csh", "tcsh"].includes(shell)) return false
  return argv.length === 1 || argv.slice(1).some((arg) => arg === "--interactive" || /^-[^-]*i/.test(arg))
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

    // Keep the PTY read channel open while the child handles SIGTERM. Closing
    // it first drops the child's final output before a recorder can save it.
    // Interactive shells ignore SIGTERM but exit on SIGHUP. Give a child that
    // catches TERM time to flush its final output before sending SIGHUP.
    async function exitedWithin(ms: number): Promise<boolean> {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([
          proc.exited.then(() => true),
          new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), ms)
          }),
        ])
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
    }

    try {
      const ignored = ignoresSigterm(proc.pid)
      proc.kill()
      const immediateHup = ignored === true || (ignored === null && isInteractiveShell(argv))
      // A no-op TERM handler is caught rather than kernel-ignored. It also
      // needs HUP before the KILL deadline, after a bounded output grace.
      if (!immediateHup && (await exitedWithin(1000))) return
      proc.kill(1) // SIGHUP
      if (!(await exitedWithin(immediateHup ? 2000 : 1000))) {
        proc.kill(9) // SIGKILL
        await proc.exited
      }
    } catch {
      // Ignore cleanup errors
    } finally {
      proc.closePty()
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
