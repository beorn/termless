import { describe, test, expect } from "vitest"
import { createSessionManager } from "../src/session.ts"

const CAPTURE_TIMEOUT_MS = 10_000

describe("CLI capture integration", () => {
  test("capture echo command output", { timeout: 20_000 }, async () => {
    const manager = createSessionManager()
    try {
      const { terminal } = await manager.createSession({
        command: ["echo", "hello capture"],
        cols: 80,
        rows: 24,
        timeout: CAPTURE_TIMEOUT_MS,
      })
      expect(terminal.getText()).toContain("hello capture")
    } finally {
      await manager.stopAll()
    }
  })

  test("custom dimensions are respected", { timeout: 20_000 }, async () => {
    const manager = createSessionManager()
    try {
      const { terminal } = await manager.createSession({
        command: ["echo", "test"],
        cols: 120,
        rows: 40,
        timeout: CAPTURE_TIMEOUT_MS,
      })
      expect(terminal.cols).toBe(120)
      expect(terminal.rows).toBe(40)
    } finally {
      await manager.stopAll()
    }
  })

  test("waitFor text matching", { timeout: 20_000 }, async () => {
    const manager = createSessionManager()
    try {
      const { terminal } = await manager.createSession({
        command: ["echo", "ready to go"],
        waitFor: "ready to go",
        timeout: CAPTURE_TIMEOUT_MS,
      })
      expect(terminal.getText()).toContain("ready to go")
    } finally {
      await manager.stopAll()
    }
  })

  test("screenshot SVG from session", { timeout: 20_000 }, async () => {
    const manager = createSessionManager()
    try {
      const { terminal } = await manager.createSession({
        command: ["echo", "screenshot me"],
        timeout: CAPTURE_TIMEOUT_MS,
      })
      const svg = terminal.screenshotSvg()
      expect(svg).toContain("<svg")
      expect(svg).toContain("screenshot me")
    } finally {
      await manager.stopAll()
    }
  })

  test("timeout on command with no output", { timeout: 15_000 }, async () => {
    const manager = createSessionManager()
    try {
      await expect(
        manager.createSession({
          command: ["sleep", "60"],
          waitFor: "this will never appear",
          timeout: 500,
        }),
      ).rejects.toThrow(/[Tt]imeout/)
    } finally {
      await manager.stopAll()
    }
  })
})
