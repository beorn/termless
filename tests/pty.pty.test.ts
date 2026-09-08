/**
 * PTY integration tests for termless.
 *
 * Spawns real child processes with PTYs via createTerminal + createXtermBackend.
 * Marked .pty. to run in the dedicated PTY vitest project (no isTTY override).
 */

import { afterEach, describe, test, expect, vi } from "vitest"
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
// `spawnPty` supplies FORCE_COLOR and TERM, and they are DEFAULTS: they fill in
// what the environment does not say, and never override what it does. That
// distinction is the whole contract here, because it used to be the other way
// round and the reversal was silent.
//
// Until 2026-09-08 the values were written unconditionally, so a hardcoded
// FORCE_COLOR=1 — the SIXTEEN-colour tier, not "colour on" — overwrote both the
// ambient environment and the `TERM=xterm-256color` set beside it, leaving every
// hosted app BELOW the tier a bare TERM would have given it. A test that stubbed
// FORCE_COLOR saw its stub silently discarded for the child, and a recording
// taken through this PTY showed a Nord theme collapsed to greys: #81a1c1 (blue)
// to #c0c0c0, #bf616a (error red) to #808080 — the same grey as muted text. Two
// display defects were reported and ruled on from such a capture before the
// instrument was found; both were withdrawn and the component was correct.
//
// So the order is: the caller's explicit `env` beats everything, an ambient
// value beats the defaults, and the defaults apply only to what nobody set.

describe.skipIf(!hasPty)("the COLOUR PALETTE a spawned child is given", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

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

  test("defaults the child to FORCE_COLOR=3 — truecolor — when nothing in the environment says otherwise", async () => {
    // An instrument built to CAPTURE colour wants the widest palette, so that a
    // finding taken through it is about the app and not about the tier.
    vi.stubEnv("FORCE_COLOR", undefined)
    vi.stubEnv("NO_COLOR", undefined)
    expect(await readEnv("FORCE_COLOR")).toBe("3")
  })

  test("RESPECTS an ambient FORCE_COLOR instead of overwriting it — this is what vi.stubEnv used to lie about", async () => {
    // The reversal that cost a day: a test process could stub this and watch the
    // child receive something else entirely, with nothing reporting the
    // substitution. 2 is chosen deliberately — it is neither the old hardcoded
    // value nor the new default, so passing cannot be a coincidence of either.
    vi.stubEnv("FORCE_COLOR", "2")
    expect(await readEnv("FORCE_COLOR")).toBe("2")
  })

  test("RESPECTS an ambient NO_COLOR by not injecting a palette over it", async () => {
    // Asking for no colour is an answer, not an absence, so the default must not
    // fill in over it. Without this the instrument would silently re-enable what
    // the environment just switched off.
    vi.stubEnv("FORCE_COLOR", undefined)
    vi.stubEnv("NO_COLOR", "1")
    expect(await readEnv("FORCE_COLOR")).toBe("")
  })

  test("a caller's explicit env still beats both the ambient value and the default", async () => {
    // The spawn spreads the caller's env last, so an explicit request always
    // wins. This is how a deliberate 16-colour capture is still taken.
    vi.stubEnv("FORCE_COLOR", "2")
    expect(await readEnv("FORCE_COLOR", { FORCE_COLOR: "1" })).toBe("1")
  })

  test("treats an EMPTY FORCE_COLOR as an answer, not as absence — the detector does too", async () => {
    // Found by this suite's own first red run: `FORCE_COLOR=` is SET, and
    // silvery's detector reads any defined value as a tier request rather than
    // falling through. If the defaults filled in over it, the instrument and the
    // detector would disagree about the same variable — which is precisely the
    // two-inputs-one-wins-silently class this change exists to end.
    vi.stubEnv("FORCE_COLOR", "")
    expect(await readEnv("FORCE_COLOR")).toBe("")
  })

  test("supplies TERM when the environment has none, and leaves an ambient TERM alone", async () => {
    vi.stubEnv("TERM", undefined)
    expect(await readEnv("TERM")).toBe("xterm-256color")
    vi.stubEnv("TERM", "screen-256color")
    expect(await readEnv("TERM")).toBe("screen-256color")
  })
})
