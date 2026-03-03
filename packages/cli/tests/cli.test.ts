import { describe, it, expect } from "vitest"
import { createSessionManager } from "../src/session.ts"

describe("session manager", () => {
  it("creates a feed-only session (no PTY)", async () => {
    const manager = createSessionManager()

    try {
      const { id, terminal } = await manager.createSession({
        cols: 80,
        rows: 24,
      })

      expect(id).toBe("session-1")
      expect(terminal.cols).toBe(80)
      expect(terminal.rows).toBe(24)
      expect(terminal.alive).toBe(false)

      // Feed data directly
      terminal.feed("Hello, termless!")
      expect(terminal.getText()).toContain("Hello, termless!")
    } finally {
      await manager.stopAll()
    }
  })

  it("gets text from a session", async () => {
    const manager = createSessionManager()

    try {
      const { id, terminal } = await manager.createSession()

      terminal.feed("line 1\r\nline 2\r\nline 3")
      const text = manager.getSession(id).getText()

      expect(text).toContain("line 1")
      expect(text).toContain("line 2")
      expect(text).toContain("line 3")
    } finally {
      await manager.stopAll()
    }
  })

  it("lists sessions", async () => {
    const manager = createSessionManager()

    try {
      await manager.createSession({ cols: 80, rows: 24 })
      await manager.createSession({ cols: 120, rows: 40 })

      const sessions = manager.listSessions()
      expect(sessions).toHaveLength(2)
      expect(sessions[0]!.id).toBe("session-1")
      expect(sessions[0]!.cols).toBe(80)
      expect(sessions[1]!.id).toBe("session-2")
      expect(sessions[1]!.cols).toBe(120)
    } finally {
      await manager.stopAll()
    }
  })

  it("stops a session", async () => {
    const manager = createSessionManager()

    const { id } = await manager.createSession()
    expect(manager.listSessions()).toHaveLength(1)

    await manager.stopSession(id)
    expect(manager.listSessions()).toHaveLength(0)
  })

  it("throws when stopping nonexistent session", async () => {
    const manager = createSessionManager()

    await expect(manager.stopSession("session-999")).rejects.toThrow("Session not found: session-999")
  })

  it("throws when getting nonexistent session", () => {
    const manager = createSessionManager()

    expect(() => manager.getSession("session-999")).toThrow("Session not found: session-999")
  })

  it("stops all sessions", async () => {
    const manager = createSessionManager()

    await manager.createSession()
    await manager.createSession()
    await manager.createSession()
    expect(manager.listSessions()).toHaveLength(3)

    await manager.stopAll()
    expect(manager.listSessions()).toHaveLength(0)
  })

  it("increments session IDs", async () => {
    const manager = createSessionManager()

    try {
      const s1 = await manager.createSession()
      const s2 = await manager.createSession()
      const s3 = await manager.createSession()

      expect(s1.id).toBe("session-1")
      expect(s2.id).toBe("session-2")
      expect(s3.id).toBe("session-3")
    } finally {
      await manager.stopAll()
    }
  })
})
