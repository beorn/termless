/**
 * PTY integration tests for termless.
 *
 * Spawns real child processes with PTYs via createTerminal + createXtermBackend.
 * Marked .pty. to run in the dedicated PTY vitest project (no isTTY override).
 */

import { describe, test, expect } from "vitest"
import { createTerminal } from "../src/terminal/terminal.ts"
import { createXtermBackend } from "../packages/xtermjs/src/backend.ts"
import "../packages/viterm/src/matchers.ts"

// ── PTY availability check ──
// Vitest runs in Node.js context. PTY requires node-pty on Node.js.
// Skip gracefully when not installed (Bun uses native PTY instead).

const isBun = typeof globalThis.Bun !== "undefined"
const nodePtySpecifier = "node-pty"

let hasPty = isBun
if (!isBun) {
  try {
    await import(nodePtySpecifier)
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

  test("alive becomes false after process exits", async () => {
    const term = createXterm()
    try {
      await term.spawn(["echo", "done"])
      const deadline = Date.now() + 5000
      while (!term.exitInfo && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50))
      }
      expect(term.exitInfo).toContain("exit=")
      expect(term.alive).toBe(false)
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

// ── Colour palette handed to the child ──
//
// `spawnPty` sets FORCE_COLOR and TERM together, and the two DISAGREE: every
// mainstream detector reads FORCE_COLOR first, where "1" means the 16-colour
// tier, so the `xterm-256color` set beside it never gets a vote. The child is
// therefore pinned BELOW what it would have detected from the TERM alone.
//
// These tests exist because nothing here read the palette back, and a day was
// spent attributing a 16-colour capture to the application under test: a Nord
// theme quantised to ansi16 renders #81a1c1 (blue) as #c0c0c0 and #bf616a
// (red) as #808080, so "the app is not using blue" and "the app is not using
// red" are both guaranteed observations that carry no information.
//
// They pin the CURRENT behaviour deliberately. Changing the constant moves
// every screenshot and trace baseline in the estate at once, so the flip is
// gated on a survey of those baselines; when it happens, these are the tests
// that must change with it, which is the point.

describe.skipIf(!hasPty)("the COLOUR PALETTE a spawned child is given", () => {
  async function readEnv(name: string, override?: Record<string, string>): Promise<string> {
    const term = createXterm()
    try {
      await term.spawn(["sh", "-c", `printf "<%s>" "$${name}"`], override === undefined ? undefined : { env: override })
      await expect(term.screen).toContainText(">", { timeout: 5000 })
      const shown = /<([^>]*)>/u.exec(term.screen.getText())
      return shown?.[1] ?? "NO MATCH"
    } finally {
      await term.close()
    }
  }

  test("hands the child FORCE_COLOR=1, which means SIXTEEN colours, not 'colour enabled'", async () => {
    expect(await readEnv("FORCE_COLOR")).toBe("1")
  })

  test("also sets TERM=xterm-256color, which FORCE_COLOR overrides — the two disagree by construction", async () => {
    // Both are really there; the defect is not a missing variable, it is that
    // the loser is set deliberately and reads as if it were in force.
    expect(await readEnv("TERM")).toBe("xterm-256color")
  })

  test("a caller CAN override the palette, which is how a truecolor capture is taken", async () => {
    // The spawn spreads the caller's env AFTER the defaults, so passing
    // FORCE_COLOR=3 is the supported way to read real colours through a PTY.
    expect(await readEnv("FORCE_COLOR", { FORCE_COLOR: "3" })).toBe("3")
  })
})
