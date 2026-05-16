/**
 * Session Manager — shared between CLI and MCP server.
 *
 * Manages named terminal sessions backed by termless + xterm.js.
 * Each session wraps a Terminal instance with optional PTY process.
 */

import { createTerminal } from "@termless/core"
import type { Terminal, SvgScreenshotOptions, TerminalBackend } from "@termless/core"
import { createXtermBackend } from "@termless/xtermjs"

// ── Types ──

/**
 * Backend name accepted by createSession. Default is "xtermjs" (the historical
 * behavior, fast + portable). "ghostty" uses ghostty-web WASM and is the
 * highest-fidelity headless backend — matches what real Ghostty renders, so
 * screenshots reflect true truecolor + glyph fidelity. "vterm" uses vterm.js
 * (pure-TS, standards-compliant). "vt100" uses the minimal VT100 emulator.
 *
 * Visual-bug-close evidence (Layer 2 screenshot at user's terminal size) should
 * use "ghostty" — xterm.js headless drops truecolor and falls back on glyphs
 * (em-dashes, sigils, box-drawing) which produces misleading screenshots that
 * misrepresent km view rendering. See bead @km/all/15297-agent-screenshot-fidelity-gap.
 */
export type SessionBackend = "xtermjs" | "ghostty" | "vterm" | "vt100"

export interface SessionCreateOptions {
  command?: string[]
  env?: Record<string, string>
  cwd?: string
  cols?: number
  rows?: number
  waitFor?: string | "content" | "stable"
  timeout?: number
  backend?: SessionBackend
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
}

// ── Internal session record ──

interface SessionRecord {
  terminal: Terminal
  command?: string[]
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
    const terminal = createTerminal({ backend, cols, rows })

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

    sessions.set(id, { terminal, command: opts.command })
    return { id, terminal }
  }

  function getSession(id: string): Terminal {
    const record = sessions.get(id)
    if (!record) throw new Error(`Session not found: ${id}`)
    return record.terminal
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

  return { createSession, getSession, listSessions, stopSession, stopAll }
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
