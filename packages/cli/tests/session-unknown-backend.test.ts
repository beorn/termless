/**
 * @failure  a caller asks for backend "vtem" and silently gets a working vterm
 *   session instead of an error, so a typo in a config file or an MCP client
 *   looks exactly like success and the wrong emulator is measured for as long
 *   as nobody reads the code
 * @level    l1 — real SessionManager, no PTY, no render
 * @consumer @km/infra/22814-resolvebackend-fail-loud — @chief's acceptance:
 *   throw naming the bad value AND listing the valid names.
 *   CLAUDE.md § "Fail Loud, Fail Now": no defensive fallbacks for internal code.
 *
 * ## Why this needs an untyped cast, and why that is the point
 *
 * `SessionBackend` is an exhaustive union, so `resolveBackend`'s `default:`
 * branch is unreachable for any caller TypeScript checks — which is exactly why
 * it went unnoticed. The reachable callers are the ones the compiler never saw:
 * plain-JS consumers, a config file parsed at runtime, an MCP client sending
 * arbitrary JSON. The cast below is not a test trick working around a type; it
 * is a faithful model of the only callers that can reach this line.
 *
 * ## Why "it still returned a terminal" is the bug, not a mitigation
 *
 * The old fallback returned a real, working backend. That is what made it
 * dangerous: every downstream assertion passes, the session behaves, and the
 * only symptom is that the emulator under test is not the one that was named.
 * A silent substitution is worse than a crash here precisely because it is
 * survivable — the earlier version of this fallback returned xterm.js, which
 * meant a typo silently opted a caller back into the retired engine.
 */

import { describe, expect, test } from "vitest"
import { createSessionManager, SESSION_BACKENDS } from "../src/session.ts"

/** The shape of a caller the compiler never checked — a config value, or MCP JSON. */
function untypedBackend(name: string): { backend: never } {
  return { backend: name } as unknown as { backend: never }
}

describe("unknown backend name is refused, not substituted (@km/infra/22814)", () => {
  test("createSession throws instead of quietly returning a different emulator", async () => {
    const manager = createSessionManager()
    try {
      await expect(manager.createSession(untypedBackend("vtem"))).rejects.toThrow()
    } finally {
      await manager.stopAll()
    }
  })

  test("the error names the offending value", async () => {
    const manager = createSessionManager()
    try {
      // Naming the bad value is what makes the error actionable: "unknown
      // backend" alone sends the reader hunting for which of their configs did it.
      await expect(manager.createSession(untypedBackend("vtem"))).rejects.toThrow(/vtem/u)
    } finally {
      await manager.stopAll()
    }
  })

  test("the error lists every valid name, and the list cannot drift", async () => {
    const manager = createSessionManager()
    try {
      let message = ""
      try {
        await manager.createSession(untypedBackend("definitely-not-a-backend"))
      } catch (err) {
        message = err instanceof Error ? err.message : String(err)
      }

      // Asserted against the exported constant rather than a literal list, so a
      // sixth backend cannot be added with the error message left behind — the
      // failure would otherwise be a stale suggestion, which is the same class
      // of defect as the silent fallback this bead removes.
      expect(SESSION_BACKENDS.length).toBeGreaterThan(0)
      for (const name of SESSION_BACKENDS) {
        expect(message).toContain(name)
      }
    } finally {
      await manager.stopAll()
    }
  })

  test("control: every valid name still resolves, so the guard is not over-broad", async () => {
    // A throw-everything guard would pass all three tests above. Pure-JS
    // backends only: ghostty needs WASM init and peekaboo is macOS-only, so
    // including them would test the environment rather than the guard.
    for (const backend of ["xtermjs", "vterm", "vt100"] as const) {
      const manager = createSessionManager()
      try {
        const { terminal } = await manager.createSession({ backend, cols: 20, rows: 3 })
        terminal.feed("ok")
        expect(terminal.getText()).toContain("ok")
      } finally {
        await manager.stopAll()
      }
    }
  })
})
