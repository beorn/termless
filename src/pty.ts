/**
 * PTY module for termless.
 *
 * Spawns a child process with a pseudo-terminal using Bun's native PTY support
 * and bridges its I/O to a TerminalBackend via callbacks.
 */

// ── Types ──

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

export interface PtySpawnOptions {
  /** Command to execute as [program, ...args]. Joined and run via bash -c. */
  command: string[]
  /** Additional environment variables (merged with process.env). */
  env?: Record<string, string>
  /** Working directory for the child process. */
  cwd?: string
  /** Terminal columns. */
  cols: number
  /** Terminal rows. */
  rows: number
  /** Callback invoked when the child process writes output data. */
  onData: (data: Uint8Array) => void
}

// ── Implementation ──

/**
 * Spawn a child process with a PTY and return a handle for interacting with it.
 *
 * Uses Bun.spawn with the `terminal` option for native PTY support.
 * The command is wrapped in `bash -c` to support shell features (pipes, env vars, etc.).
 * Sets FORCE_COLOR=1 and TERM=xterm-256color to ensure proper color output.
 */
export function spawnPty(options: PtySpawnOptions): PtyHandle {
  const { command, env, cwd, cols, rows, onData } = options

  const proc = Bun.spawn(["bash", "-c", command.join(" ")], {
    cwd,
    env: {
      ...process.env,
      FORCE_COLOR: "1",
      TERM: "xterm-256color",
      ...env,
    },
    terminal: {
      cols,
      rows,
      data: (_terminal, data) => {
        try {
          onData(data)
        } catch {
          // Swallow callback errors to prevent crashing the event loop.
          // The PTY data callback runs synchronously in Bun's event loop --
          // an unhandled throw here would crash the entire process.
        }
      },
    },
  })

  // Access the PTY write channel (typed by @types/bun when terminal option is used)
  const pty = proc.terminal as {
    write: (data: string) => void
    close: () => void
    resize: (cols: number, rows: number) => void
  }

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
    try {
      pty.close()
    } catch {
      // Ignore cleanup errors
    }

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
      pty.write(data)
    },

    resize(newCols: number, newRows: number): void {
      if (closed) throw new Error("PTY is closed")
      pty.resize(newCols, newRows)
    },

    get alive(): boolean {
      return !closed && proc.exitCode === null
    },

    get exitInfo(): string | null {
      if (exitCode !== null) return `exit=${exitCode}`
      return null
    },

    close,
  }
}
