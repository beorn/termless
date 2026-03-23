/**
 * PTY integration tests for termless.
 *
 * Spawns real child processes with PTYs via createTerminal + createXtermBackend.
 * Marked .pty. to run in the dedicated PTY vitest project (no isTTY override).
 */

import { describe, test, expect } from "vitest"
import { createTerminal } from "../src/terminal.ts"
import { createXtermBackend } from "../packages/xtermjs/src/backend.ts"
import "../packages/viterm/src/matchers.ts"

// ── PTY availability check ──
// Vitest runs in Node.js context. PTY requires node-pty on Node.js.
// Skip gracefully when not installed (Bun uses native PTY instead).

const isBun = typeof globalThis.Bun !== "undefined"

let hasPty = isBun
if (!isBun) {
  try {
    const { createRequire } = await import("node:module")
    createRequire(import.meta.url)("node-pty")
    hasPty = true
  } catch {
    hasPty = false
  }
}

// ── Helper ──

function createXterm(cols = 80, rows = 24) {
  return createTerminal({ backend: createXtermBackend(), cols, rows })
}

// ── Tests ──

describe.skipIf(!hasPty)("PTY integration", () => {
  test("spawn echo captures output", async () => {
    const term = createXterm()
    try {
      await term.spawn(["echo", "hello termless"])
      await expect(term.screen).toContainText("hello termless", { timeout: 5000 })
    } finally {
      await term.close()
    }
  })

  test("alive is true during running process", async () => {
    const term = createXterm()
    try {
      await term.spawn(["sleep", "10"])
      expect(term.alive).toBe(true)
    } finally {
      await term.close()
    }
  })

  test("exitInfo populated after process exits", async () => {
    const term = createXterm()
    try {
      await term.spawn(["echo", "done"])
      // Poll for exit info instead of fixed delay — avoids race condition
      const deadline = Date.now() + 5000
      while (!term.exitInfo && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50))
      }
      expect(term.exitInfo).toContain("exit=")
    } finally {
      await term.close()
    }
  })

  test("press sends key to PTY", async () => {
    const term = createXterm()
    try {
      // Use bash -c explicitly for shell features (&&, $variable)
      await term.spawn(["bash", "-c", "read line && echo got:$line"])
      term.type("hello")
      term.press("Enter")
      await expect(term.screen).toContainText("got:hello", { timeout: 5000 })
    } finally {
      await term.close()
    }
  })

  test("type sends text to PTY", async () => {
    const term = createXterm()
    try {
      // Use bash -c explicitly for shell features (&&, $variable)
      await term.spawn(["bash", "-c", "read line && echo got:$line"])
      term.type("typed text\n")
      await expect(term.screen).toContainText("got:typed text", { timeout: 5000 })
    } finally {
      await term.close()
    }
  })

  test("spawn preserves arguments with spaces (no shell injection)", async () => {
    const term = createXterm()
    try {
      // Arguments with spaces should be passed as-is, not split by shell
      await term.spawn(["echo", "hello world", "foo bar"])
      await expect(term.screen).toContainText("hello world foo bar", { timeout: 5000 })
    } finally {
      await term.close()
    }
  })

  test("spawn preserves shell metacharacters in arguments", async () => {
    const term = createXterm()
    try {
      // Shell metacharacters in arguments should be passed literally
      await term.spawn(["echo", "$(whoami)", ";echo injected"])
      // Should see the literal strings, not their shell-expanded values.
      // The argument ";echo injected" should appear as-is (a single argument
      // to echo), NOT as a separate shell command that would produce a second
      // line of output containing just "injected".
      await expect(term.screen).toContainText("$(whoami)", { timeout: 5000 })
      expect(term.screen).toContainText(";echo injected")
    } finally {
      await term.close()
    }
  })

  test("resize during active process", async () => {
    const term = createXterm(80, 24)
    try {
      await term.spawn(["cat"])
      term.resize(120, 40)
      expect(term.cols).toBe(120)
      expect(term.rows).toBe(40)
    } finally {
      await term.close()
    }
  })
})
