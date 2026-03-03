import { describe, test, expect } from "vitest"
import { createSessionManager } from "../src/session.ts"

describe("CLI capture integration", () => {
  test("capture echo command output", async () => {
    const manager = createSessionManager()
    try {
      const { terminal } = await manager.createSession({
        command: ["echo", "hello capture"],
        cols: 80,
        rows: 24,
        timeout: 5000,
      })
      expect(terminal.getText()).toContain("hello capture")
    } finally {
      await manager.stopAll()
    }
  })

  test("custom dimensions are respected", async () => {
    const manager = createSessionManager()
    try {
      const { terminal } = await manager.createSession({
        command: ["echo", "test"],
        cols: 120,
        rows: 40,
        timeout: 5000,
      })
      expect(terminal.cols).toBe(120)
      expect(terminal.rows).toBe(40)
    } finally {
      await manager.stopAll()
    }
  })

  test("waitFor text matching", async () => {
    const manager = createSessionManager()
    try {
      const { terminal } = await manager.createSession({
        command: ["echo", "ready to go"],
        waitFor: "ready to go",
        timeout: 5000,
      })
      expect(terminal.getText()).toContain("ready to go")
    } finally {
      await manager.stopAll()
    }
  })

  test("screenshot SVG from session", async () => {
    const manager = createSessionManager()
    try {
      const { terminal } = await manager.createSession({
        command: ["echo", "screenshot me"],
        timeout: 5000,
      })
      const svg = terminal.screenshotSvg()
      expect(svg).toContain("<svg")
      expect(svg).toContain("screenshot me")
    } finally {
      await manager.stopAll()
    }
  })

  test("timeout on command with no output", async () => {
    const manager = createSessionManager()
    try {
      await expect(
        manager.createSession({
          command: ["sleep", "60"],
          waitFor: "this will never appear",
          timeout: 500,
        })
      ).rejects.toThrow(/[Tt]imeout/)
    } finally {
      await manager.stopAll()
    }
  })
})
