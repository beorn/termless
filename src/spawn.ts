/**
 * Portable PTY spawn abstraction.
 *
 * Detects the runtime (Bun vs Node.js) and uses the appropriate PTY backend:
 * - Bun: native `Bun.spawn()` with `terminal` option
 * - Node.js: `node-pty` (optional peer dependency — throws if not installed)
 */

import { createRequire } from "node:module"

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

  const proc = Bun.spawn(argv, {
    cwd,
    env: { ...process.env, ...env },
    terminal: {
      cols,
      rows,
      data: (_terminal: unknown, data: Uint8Array) => {
        try {
          onData(data)
        } catch {
          // Swallow callback errors to prevent crashing the event loop.
        }
      },
    },
  })

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

/** Minimal interface matching what we use from node-pty's IPty. */
interface NodePtyInstance {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
  destroy(): void
  onData: (callback: (data: string) => void) => { dispose(): void }
  onExit: (callback: (e: { exitCode: number; signal?: number }) => void) => { dispose(): void }
  pid: number
}

/** Minimal interface for the node-pty module. */
interface NodePtyModule {
  spawn(
    file: string,
    args: string[],
    options: {
      name?: string
      cols: number
      rows: number
      cwd?: string
      env?: Record<string, string>
    },
  ): NodePtyInstance
}

/**
 * Load node-pty synchronously using createRequire.
 *
 * node-pty is a CommonJS native addon, so createRequire is the correct way
 * to load it from ESM. This keeps spawnPortablePty() synchronous.
 */
function loadNodePty(): NodePtyModule {
  try {
    const nodeRequire = createRequire(import.meta.url)
    return nodeRequire("node-pty") as NodePtyModule
  } catch {
    throw new Error(
      "node-pty is required for PTY support on Node.js but was not found.\n" +
        "Install it with: npm install node-pty\n" +
        "Note: node-pty requires native compilation tools (Python, C++ compiler).",
    )
  }
}

function spawnNodePty(options: PortablePtySpawnOptions): PortablePtyProcess {
  const { argv, cols, rows, cwd, env, onData } = options

  const nodePty = loadNodePty()

  const [file, ...args] = argv
  const ptyProcess = nodePty.spawn(file, args, {
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
      const sig = signal === 9 ? "SIGKILL" : "SIGTERM"
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
