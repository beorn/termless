/**
 * Session Manager — shared between CLI and MCP server.
 *
 * Manages named terminal sessions backed by termless + xterm.js.
 * Each session wraps a Terminal instance with optional PTY process.
 */

import { createTerminal } from "@termless/core"
import type { FrameTracer, Terminal, TerminalBackend } from "@termless/core"
import { createXtermBackend } from "@termless/xtermjs"

// ── Types ──

/**
 * Backend name accepted by createSession. Default is "xtermjs" (the historical
 * behavior, fast + portable). "ghostty" uses ghostty-web WASM and is the
 * highest-fidelity headless backend — matches what real Ghostty renders, so
 * screenshots reflect true truecolor + glyph fidelity. "vterm" uses vterm.js
 * (pure-TS, standards-compliant). "vt100" uses the minimal VT100 emulator.
 * "peekaboo" drives a real terminal app via OS automation (macOS only) —
 * pixel-perfect against the user's actual terminal, slowest of all backends.
 *
 * Visual-bug-close evidence (Layer 2 screenshot at user's terminal size) should
 * use "ghostty" — xterm.js headless drops truecolor and falls back on glyphs
 * (em-dashes, sigils, box-drawing) which produces misleading screenshots that
 * misrepresent km view rendering. See bead @km/all/15297-agent-screenshot-fidelity-gap.
 */
export type SessionBackend = "xtermjs" | "ghostty" | "vterm" | "vt100" | "peekaboo"

export interface SessionCreateOptions {
  command?: string[]
  env?: Record<string, string>
  cwd?: string
  cols?: number
  rows?: number
  waitFor?: string | "content" | "stable"
  timeout?: number
  backend?: SessionBackend
  /**
   * Hook fired after every successful write to the backend (both `feed()` calls
   * and PTY-spawned data). Used by frame-trace mode and other observers that
   * need to react to buffer mutations without polling. Forwarded to
   * `createTerminal({ onAfterWrite })`.
   */
  onAfterWrite?: (data: Uint8Array) => void
}

export interface SessionInfo {
  id: string
  command?: string[]
  cols: number
  rows: number
  alive: boolean
}

export interface SessionManager {
  createSession(opts?: SessionCreateOptions): Promise<{ id: string; terminal: Terminal }>
  getSession(id: string): Terminal
  listSessions(): SessionInfo[]
  stopSession(id: string): Promise<void>
  stopAll(): Promise<void>
  /**
   * Attach a {@link FrameTracer} to an existing session. The tracer's `onWrite`
   * is invoked by the `onAfterWrite` hook passed to `createSession`; this just
   * stores the tracer so callers can look it up by session id (and so that
   * `stopSession` can finalize it before closing the terminal).
   *
   * For the wiring to work end-to-end, the caller must pass `onAfterWrite:
   * (data) => tracer.onWrite(data)` to `createSession()` before calling
   * `attachTracer()`. Attaching after the session is created (rather than at
   * creation time) keeps the API symmetric with the bearly tty pattern, where
   * the late-bound tracer reference is captured by closure.
   *
   * `dir` is the trace output directory passed to `createFrameTracer`. Stored
   * alongside the tracer so `getTraceDir` can resolve PNG paths absolutely
   * (the FrameTracer's `Frame.png` field is relative to `dir`).
   */
  attachTracer(id: string, tracer: FrameTracer, dir: string): void
  /** Get the tracer attached to a session, or `null` if none was attached. */
  getTracer(id: string): FrameTracer | null
  /** Get the trace output dir for a session, or `null` if no tracer is attached. */
  getTraceDir(id: string): string | null
}

// ── Internal session record ──

interface SessionRecord {
  terminal: Terminal
  command?: string[]
  tracer: FrameTracer | null
  traceDir: string | null
}

// ── Constants ──

const DEFAULT_COLS = 120
const DEFAULT_ROWS = 40
const DEFAULT_TIMEOUT = 5000
const DEFAULT_STABLE_MS = 200
const POLL_INTERVAL = 50

// ── Factory ──

export function createSessionManager(): SessionManager {
  let counter = 0
  const sessions = new Map<string, SessionRecord>()

  async function createSession(opts: SessionCreateOptions = {}): Promise<{ id: string; terminal: Terminal }> {
    const cols = opts.cols ?? DEFAULT_COLS
    const rows = opts.rows ?? DEFAULT_ROWS
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT
    const backendName: SessionBackend = opts.backend ?? "xtermjs"

    const backend: TerminalBackend = await resolveBackend(backendName)
    const terminal = createTerminal({ backend, cols, rows, onAfterWrite: opts.onAfterWrite })

    counter++
    const id = `session-${counter}`

    try {
      // Spawn command if provided
      if (opts.command && opts.command.length > 0) {
        await terminal.spawn(opts.command, {
          env: opts.env,
          cwd: opts.cwd,
        })

        // Wait for content based on waitFor option
        if (opts.waitFor === "stable") {
          await terminal.waitForStable(DEFAULT_STABLE_MS, timeout)
        } else if (opts.waitFor && opts.waitFor !== "content") {
          await terminal.waitFor(opts.waitFor, timeout)
        } else {
          // Default: wait for any content
          await waitForContent(terminal, timeout)
        }
      }
    } catch (error) {
      // Clean up the PTY/backend if setup fails — without this,
      // the terminal is never tracked in sessions and stopAll() won't close it.
      await terminal.close()
      throw error
    }

    sessions.set(id, { terminal, command: opts.command, tracer: null, traceDir: null })
    return { id, terminal }
  }

  function getSession(id: string): Terminal {
    const record = sessions.get(id)
    if (!record) throw new Error(`Session not found: ${id}`)
    return record.terminal
  }

  function attachTracer(id: string, tracer: FrameTracer, dir: string): void {
    const record = sessions.get(id)
    if (!record) throw new Error(`Session not found: ${id}`)
    record.tracer = tracer
    record.traceDir = dir
  }

  function getTracer(id: string): FrameTracer | null {
    const record = sessions.get(id)
    if (!record) throw new Error(`Session not found: ${id}`)
    return record.tracer
  }

  function getTraceDir(id: string): string | null {
    const record = sessions.get(id)
    if (!record) throw new Error(`Session not found: ${id}`)
    return record.traceDir
  }

  function listSessions(): SessionInfo[] {
    return Array.from(sessions.entries()).map(([id, record]) => ({
      id,
      command: record.command,
      cols: record.terminal.cols,
      rows: record.terminal.rows,
      alive: record.terminal.alive,
    }))
  }

  async function stopSession(id: string): Promise<void> {
    const record = sessions.get(id)
    if (!record) throw new Error(`Session not found: ${id}`)
    await record.terminal.close()
    sessions.delete(id)
  }

  async function stopAll(): Promise<void> {
    const closePromises = Array.from(sessions.values()).map((record) => record.terminal.close())
    await Promise.all(closePromises)
    sessions.clear()
  }

  return {
    createSession,
    getSession,
    listSessions,
    stopSession,
    stopAll,
    attachTracer,
    getTracer,
    getTraceDir,
  }
}

// ── Backend resolution ──

/**
 * Resolve a backend name to a TerminalBackend instance. xtermjs is sync; the
 * rest are async to handle WASM/init. Falls back to xtermjs on unknown name
 * (defensive — type system already constrains the input but runtime callers
 * may pass arbitrary strings).
 */
async function resolveBackend(name: SessionBackend): Promise<TerminalBackend> {
  switch (name) {
    case "xtermjs":
      return createXtermBackend()
    case "ghostty": {
      const mod = await import("@termless/ghostty")
      return mod.resolve()
    }
    case "vterm": {
      const mod = await import("@termless/vterm")
      return mod.resolve()
    }
    case "vt100": {
      const mod = await import("@termless/vt100")
      return mod.resolve()
    }
    case "peekaboo": {
      // macOS-only OS automation backend. Failure surface (e.g. running on
      // Linux, missing osascript, or no terminal app installed) bubbles up
      // to the caller — we don't silently fall back to xtermjs because that
      // would mislead callers asking for pixel-perfect evidence.
      const mod = await import("@termless/peekaboo")
      return mod.resolve()
    }
    default:
      return createXtermBackend()
  }
}

// ── Helpers ──

async function waitForContent(terminal: Terminal, timeout: number): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const text = terminal.getText().trim()
    if (text.length > 0) return
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL))
  }
  throw new Error(`Timeout waiting for content after ${timeout}ms`)
}
