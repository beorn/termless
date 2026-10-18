/**
 * Portable PTY spawn abstraction.
 *
 * Detects the runtime (Bun vs Node.js) and uses the appropriate PTY backend:
 * - Bun: native `Bun.spawn()` with `terminal` option
 * - Node.js: `node-pty` (optional peer dependency — throws if not installed)
 */

import { loadNodePty } from "../load-native.ts"

export interface PortablePtyProcess {
  /** Write data to the PTY stdin. */
  write(data: string): void
  /** Resize the PTY. */
  resize(cols: number, rows: number): void
  /** Close/destroy the PTY write channel. */
  closePty(): void
  /** Send a signal to the process (default: SIGTERM). */
  kill(signal?: number): void
  /** The process exit code (null if still running). */
  readonly exitCode: number | null
  /** A promise that resolves with the exit code when the process exits. */
  readonly exited: Promise<number>
  /** The process ID. */
  readonly pid: number
}

export interface PortablePtySpawnOptions {
  argv: string[]
  cols: number
  rows: number
  cwd?: string
  env?: Record<string, string>
  onData: (data: Uint8Array) => void
}

const isBun = typeof globalThis.Bun !== "undefined"

/**
 * Spawn a process with a PTY, using the appropriate runtime backend.
 *
 * - On Bun: uses `Bun.spawn()` with the `terminal` option (built-in PTY support).
 * - On Node.js: uses `node-pty` (loaded via createRequire). Throws a clear error if not installed.
 */
export function spawnPortablePty(options: PortablePtySpawnOptions): PortablePtyProcess {
  if (isBun) {
    return spawnBunPty(options)
  }
  return spawnNodePty(options)
}

/**
 * Pre-load node-pty for Node.js environments.
 *
 * Call this once at startup if you want to verify node-pty is available before
 * the first spawn attempt. On Bun, this is a no-op.
 *
 * Not required -- spawnPortablePty() loads node-pty on demand. But calling this
 * early gives a better error message at startup instead of at first spawn.
 */
export async function preloadNodePty(): Promise<void> {
  if (isBun) return
  loadNodePty() // will throw if not installed
}

// ── Bun implementation ──

function spawnBunPty(options: PortablePtySpawnOptions): PortablePtyProcess {
  const { argv, cols, rows, cwd, env, onData } = options
  const diagnose = argv.length === 3 && argv[0] === "echo" && argv[1] === "hello world" && argv[2] === "foo bar"

  if (diagnose)
    console.info("PTY_DIAG", JSON.stringify({ kind: "spawn", at: performance.now(), argv, bun: Bun.version }))
  const proc = Bun.spawn(argv, {
    cwd,
    env: { ...process.env, ...env },
    terminal: {
      cols,
      rows,
      data: (_terminal: unknown, data: Uint8Array) => {
        if (diagnose)
          console.info(
            "PTY_DIAG",
            JSON.stringify({
              kind: "raw",
              at: performance.now(),
              bytes: data.byteLength,
              hex: Buffer.from(data).toString("hex"),
            }),
          )
        try {
          onData(data)
          if (diagnose) console.info("PTY_DIAG", JSON.stringify({ kind: "forwarded", at: performance.now() }))
        } catch (error) {
          if (diagnose)
            console.error(
              "PTY_DIAG",
              JSON.stringify({ kind: "forward-error", at: performance.now(), error: String(error) }),
            )
          // Swallow callback errors to prevent crashing the event loop.
        }
      },
    },
  })
  if (diagnose) {
    console.info("PTY_DIAG", JSON.stringify({ kind: "spawn-returned", at: performance.now(), pid: proc.pid }))
    void proc.exited.then(
      (code) => console.info("PTY_DIAG", JSON.stringify({ kind: "exit", at: performance.now(), code })),
      (error) =>
        console.error("PTY_DIAG", JSON.stringify({ kind: "exit-error", at: performance.now(), error: String(error) })),
    )
  }

  const pty = proc.terminal as {
    write: (data: string) => void
    close: () => void
    resize: (cols: number, rows: number) => void
  }

  return {
    write(data: string): void {
      pty.write(data)
    },
    resize(newCols: number, newRows: number): void {
      pty.resize(newCols, newRows)
    },
    closePty(): void {
      if (diagnose) console.info("PTY_DIAG", JSON.stringify({ kind: "close", at: performance.now(), pid: proc.pid }))
      try {
        pty.close()
      } catch {
        // Ignore cleanup errors
      }
    },
    kill(signal?: number): void {
      proc.kill(signal)
    },
    get exitCode(): number | null {
      return proc.exitCode
    },
    get exited(): Promise<number> {
      return proc.exited
    },
    get pid(): number {
      return proc.pid
    },
  }
}

// ── Node.js implementation (node-pty) ──
// node-pty loading (a synchronous CommonJS native addon) is centralized in
// ../load-native.ts — the package's single createRequire seam.

function spawnNodePty(options: PortablePtySpawnOptions): PortablePtyProcess {
  const { argv, cols, rows, cwd, env, onData } = options

  const nodePty = loadNodePty()

  const ptyProcess = nodePty.spawn(argv[0]!, argv.slice(1), {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env: { ...process.env, ...env } as Record<string, string>,
  })

  // Bridge node-pty's string-based onData to Uint8Array
  const encoder = new TextEncoder()
  ptyProcess.onData((data: string) => {
    try {
      onData(encoder.encode(data))
    } catch {
      // Swallow callback errors to prevent crashing the event loop.
    }
  })

  // Track exit
  let _exitCode: number | null = null
  let _exitResolve: ((code: number) => void) | null = null
  const exitedPromise = new Promise<number>((resolve) => {
    _exitResolve = resolve
  })
  ptyProcess.onExit((e: { exitCode: number }) => {
    _exitCode = e.exitCode
    _exitResolve?.(e.exitCode)
  })

  return {
    write(data: string): void {
      ptyProcess.write(data)
    },
    resize(newCols: number, newRows: number): void {
      ptyProcess.resize(newCols, newRows)
    },
    closePty(): void {
      try {
        ptyProcess.destroy()
      } catch {
        // Ignore cleanup errors
      }
    },
    kill(signal?: number): void {
      // node-pty uses string signals
      const sig = signal === 1 ? "SIGHUP" : signal === 9 ? "SIGKILL" : "SIGTERM"
      try {
        ptyProcess.kill(sig)
      } catch {
        // Ignore if already dead
      }
    },
    get exitCode(): number | null {
      return _exitCode
    },
    get exited(): Promise<number> {
      return exitedPromise
    },
    get pid(): number {
      return ptyProcess.pid
    },
  }
}
