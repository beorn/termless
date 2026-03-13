/**
 * Peekaboo backend tests.
 *
 * These test the data layer (xterm.js delegation) and PTY spawning.
 * Visual tests (screenshots) are skipped unless a terminal app is available.
 */

import { describe, it, expect, afterEach } from "vitest"
import { createPeekabooBackend } from "../src/backend.ts"
import type { PtyHandle } from "../../../src/pty.ts"

describe("peekaboo backend", () => {
  let pty: PtyHandle | null = null

  afterEach(async () => {
    if (pty?.alive) {
      await pty.close()
    }
    pty = null
  })

  describe("data layer (xterm.js delegation)", () => {
    it("initializes and feeds data like xterm backend", () => {
      const backend = createPeekabooBackend()
      backend.init({ cols: 80, rows: 24 })

      const encoder = new TextEncoder()
      backend.feed(encoder.encode("Hello, peekaboo!\r\n"))

      const text = backend.getText()
      expect(text).toContain("Hello, peekaboo!")

      backend.destroy()
    })

    it("reports name as peekaboo", () => {
      const backend = createPeekabooBackend()
      backend.init({ cols: 80, rows: 24 })

      expect(backend.name).toBe("peekaboo")
      expect(backend.capabilities.name).toBe("peekaboo")

      backend.destroy()
    })

    it("has screenshot extension in capabilities", () => {
      const backend = createPeekabooBackend()
      backend.init({ cols: 80, rows: 24 })

      expect(backend.capabilities.extensions.has("screenshot")).toBe(true)

      backend.destroy()
    })

    it("delegates getCell to xterm backend", () => {
      const backend = createPeekabooBackend()
      backend.init({ cols: 80, rows: 24 })

      const encoder = new TextEncoder()
      backend.feed(encoder.encode("AB"))

      const cellA = backend.getCell(0, 0)
      expect(cellA.char).toBe("A")

      const cellB = backend.getCell(0, 1)
      expect(cellB.char).toBe("B")

      backend.destroy()
    })

    it("delegates getCursor to xterm backend", () => {
      const backend = createPeekabooBackend()
      backend.init({ cols: 80, rows: 24 })

      const encoder = new TextEncoder()
      backend.feed(encoder.encode("ABC"))

      const cursor = backend.getCursor()
      expect(cursor.x).toBe(3)
      expect(cursor.y).toBe(0)

      backend.destroy()
    })

    it("supports resize", () => {
      const backend = createPeekabooBackend()
      backend.init({ cols: 80, rows: 24 })

      // Should not throw
      backend.resize(120, 40)

      const encoder = new TextEncoder()
      backend.feed(encoder.encode("After resize"))

      expect(backend.getText()).toContain("After resize")

      backend.destroy()
    })

    it("supports reset", () => {
      const backend = createPeekabooBackend()
      backend.init({ cols: 80, rows: 24 })

      const encoder = new TextEncoder()
      backend.feed(encoder.encode("Before reset"))
      expect(backend.getText()).toContain("Before reset")

      backend.reset()

      // After RIS reset, screen should be cleared
      const text = backend.getText().trim()
      expect(text).not.toContain("Before reset")

      backend.destroy()
    })

    it("delegates encodeKey to xterm backend", () => {
      const backend = createPeekabooBackend()
      backend.init({ cols: 80, rows: 24 })

      const encoded = backend.encodeKey({ key: "Enter" })
      expect(encoded).toEqual(new Uint8Array([0x0d])) // \r

      backend.destroy()
    })
  })

  describe("visual mode", () => {
    it("reports terminalApp as null when visual is false", () => {
      const backend = createPeekabooBackend({ visual: false })
      backend.init({ cols: 80, rows: 24 })

      expect(backend.terminalApp).toBeNull()
      expect(backend.visualActive).toBe(false)
      expect(backend.appPid).toBeNull()

      backend.destroy()
    })

    it("reports terminalApp when visual is true", () => {
      const backend = createPeekabooBackend({ visual: true, app: "ghostty" })
      backend.init({ cols: 80, rows: 24 })

      expect(backend.terminalApp).toBe("ghostty")
      // Not yet active since spawnCommand hasn't been called
      expect(backend.visualActive).toBe(false)

      backend.destroy()
    })

    it("throws on takeScreenshot when visual is false", async () => {
      const backend = createPeekabooBackend({ visual: false })
      backend.init({ cols: 80, rows: 24 })

      await expect(backend.takeScreenshot()).rejects.toThrow("Visual mode is not enabled")

      backend.destroy()
    })

    it("throws on takeScreenshot when no command spawned", async () => {
      const backend = createPeekabooBackend({ visual: true })
      backend.init({ cols: 80, rows: 24 })

      await expect(backend.takeScreenshot()).rejects.toThrow("No terminal app launched")

      backend.destroy()
    })
  })

  describe("PTY spawning", () => {
    it("spawns a command and captures output via xterm backend", async () => {
      const backend = createPeekabooBackend()
      backend.init({ cols: 80, rows: 24 })

      pty = await backend.spawnCommand(["echo", "hello from peekaboo"])

      // Wait for output to arrive
      await new Promise((resolve) => setTimeout(resolve, 500))

      const text = backend.getText()
      expect(text).toContain("hello from peekaboo")

      backend.destroy()
    })

    it("throws if not initialized", async () => {
      const backend = createPeekabooBackend()

      await expect(backend.spawnCommand(["echo", "test"])).rejects.toThrow("not initialized")

      backend.destroy()
    })
  })
})
