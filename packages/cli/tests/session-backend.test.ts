/**
 * Tests for the SessionManager `backend` option — wires @termless/{ghostty,vterm,vt100}
 * through the MCP server so visual-bug-close Layer 2 screenshots can use the
 * truecolor + full-glyph Ghostty WASM backend.
 *
 * Bead: @km/all/15297-agent-screenshot-fidelity-gap.
 */
import { describe, test, expect } from "vitest"
import { createSessionManager } from "../src/session.ts"

describe("createSessionManager — backend option", () => {
  test("default backend is xtermjs (preserves historical behavior)", async () => {
    const mgr = createSessionManager()
    try {
      // No command — just session creation; terminal is alive.
      const { id, terminal } = await mgr.createSession({ cols: 40, rows: 10 })
      expect(id).toBe("session-1")
      expect(terminal.cols).toBe(40)
      expect(terminal.rows).toBe(10)
      expect(terminal).toBeDefined()
    } finally {
      await mgr.stopAll()
    }
  })

  // ghostty backend uses ghostty-web WASM which expects a browser-like
  // `self` global. The vitest config excludes packages/ghostty/tests/** for
  // the same reason; cross-backend tests run with a jsdom/happy-dom env via
  // the km parent's vendor project. We polyfill here so the wiring test
  // exercises the dynamic-import path inside resolveBackend without needing
  // the full WASM init to complete.
  test("backend: 'ghostty' resolves through resolveBackend (wiring test)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (globalThis as any).self === "undefined") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).self = globalThis
    }
    const mgr = createSessionManager()
    try {
      const { id, terminal } = await mgr.createSession({
        cols: 40,
        rows: 10,
        backend: "ghostty",
      })
      expect(id).toBe("session-1")
      expect(terminal.cols).toBe(40)
      expect(terminal.rows).toBe(10)
      expect(terminal).toBeDefined()
    } finally {
      await mgr.stopAll()
    }
  })

  test("backend: 'vterm' resolves and creates a session", async () => {
    const mgr = createSessionManager()
    try {
      const { id, terminal } = await mgr.createSession({
        cols: 40,
        rows: 10,
        backend: "vterm",
      })
      expect(id).toBe("session-1")
      expect(terminal).toBeDefined()
    } finally {
      await mgr.stopAll()
    }
  })

  test("backend: 'vt100' resolves and creates a session", async () => {
    const mgr = createSessionManager()
    try {
      const { id, terminal } = await mgr.createSession({
        cols: 40,
        rows: 10,
        backend: "vt100",
      })
      expect(id).toBe("session-1")
      expect(terminal).toBeDefined()
    } finally {
      await mgr.stopAll()
    }
  })

  // peekaboo defaults to visual=false → no real terminal app is launched, the
  // data path uses xterm.js. This wiring test exercises the dynamic-import +
  // resolve() path without requiring osascript / a Ghostty install.
  test("backend: 'peekaboo' resolves through resolveBackend (wiring test)", async () => {
    const mgr = createSessionManager()
    try {
      const { id, terminal } = await mgr.createSession({
        cols: 40,
        rows: 10,
        backend: "peekaboo",
      })
      expect(id).toBe("session-1")
      expect(terminal.cols).toBe(40)
      expect(terminal.rows).toBe(10)
      expect(terminal).toBeDefined()
    } finally {
      await mgr.stopAll()
    }
  })

  test("unknown backend name falls back to xtermjs (defensive)", async () => {
    const mgr = createSessionManager()
    try {
      const { terminal } = await mgr.createSession({
        cols: 40,
        rows: 10,
        // @ts-expect-error — exercise the runtime defensive default branch
        backend: "nonexistent-backend",
      })
      expect(terminal).toBeDefined()
    } finally {
      await mgr.stopAll()
    }
  })
})
