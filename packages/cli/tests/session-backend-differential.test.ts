/**
 * @failure  the session manager's DEFAULT backend is changed from xterm.js to
 *   vterm on the strength of "vterm is the production guest", and named
 *   terminal sessions behave differently for every CLI and MCP consumer who
 *   never asked for a change
 * @level    l1 — real SessionManager, feed-only, both backends, no PTY
 * @consumer @pm/22783-i15-workspace-usability Track 2 — @chief's ruling of
 *   2026-08-04: the guest-seam ruling does NOT extend to the backend seam by
 *   implication, and the first deliverable is a DIFFERENTIAL rather than a swap.
 *
 * ## What this is actually measuring, and what it is not
 *
 * `session.ts` is ALREADY backend-pluggable and vterm is ALREADY wired —
 * `SessionBackend` includes `"vterm"` and `resolveBackend` resolves it. So the
 * open question was never "can vterm work here". It is narrower and entirely
 * about defaults: **xtermjs is the `case` the `default:` branch falls back to**,
 * so every consumer who does not name a backend gets xterm.js today.
 *
 * That makes changing it a behaviour change for CLI and MCP users rather than a
 * cleanup, which is exactly what the ruling protects. This test supplies the
 * evidence that decision needs: it drives the SAME session lifecycle through
 * both backends and compares what a consumer can actually observe.
 *
 * ## Why the assertions are shaped this way
 *
 * The two emulators are KNOWN to differ — that is the whole point of vterm
 * (see `packages/vterm/tests/vterm-guest-differential.test.ts`, D1-D6). So
 * asserting byte-identical buffers would be asserting the opposite of the
 * design and would fail for reasons that are not defects.
 *
 * What a session CONSUMER depends on is narrower than the full render: that
 * written output arrives, that the text is readable, and that teardown is
 * clean. Those are the properties asserted per backend, plus one direct
 * comparison on the plain-text content a consumer would read. Divergence in
 * cursor shape, underline style or reflow is expected and deliberately NOT
 * asserted here.
 *
 * ## Why this feeds bytes instead of spawning a command
 *
 * A first draft spawned `echo` through a real PTY. It passed under Bun and
 * failed under Node, where PTY support needs `node-pty` — but the portability
 * break exposed a DESIGN flaw worth more than the fix: the PTY belongs to
 * `@termless/core` and is byte-identical for both backends, so spawning
 * measures core's PTY, not the thing under test. Feeding the same bytes
 * directly isolates the only variable that differs — the emulator — and makes
 * the test runtime-agnostic as a side effect.
 */

import { describe, expect, test } from "vitest"
import { createSessionManager, type SessionBackend } from "../src/session.ts"

/** Both backends under comparison. Pure-JS, no build step, no native deps. */
const BACKENDS: SessionBackend[] = ["xtermjs", "vterm"]

const MARKER = "differential-marker-9be1"

/** What a command's output looks like on the wire, minus the PTY. */
const PAYLOAD = `${MARKER}\r\n`

describe("session manager backend differential (@pm/22783 Track 2)", () => {
  for (const backend of BACKENDS) {
    test(`${backend}: written output is readable, and teardown is clean`, async () => {
      const manager = createSessionManager()
      try {
        const { id, terminal } = await manager.createSession({ backend, cols: 80, rows: 24 })
        terminal.feed(PAYLOAD)

        // The three things a session consumer actually depends on.
        expect(terminal.getText()).toContain(MARKER) // output arrived and is readable
        expect(manager.listSessions().some((s) => s.id === id)).toBe(true) // session is tracked
        await manager.stopSession(id)
        expect(manager.listSessions().some((s) => s.id === id)).toBe(false) // teardown is clean
      } finally {
        await manager.stopAll()
      }
    })
  }

  test("both backends surface the same output to a consumer", async () => {
    const seen = new Map<SessionBackend, string>()

    for (const backend of BACKENDS) {
      const manager = createSessionManager()
      try {
        const { terminal } = await manager.createSession({ backend, cols: 80, rows: 24 })
        terminal.feed(PAYLOAD)
        // Collapse whitespace: the emulators may pad the row differently, which
        // is a rendering difference, not a content one. A consumer reads text.
        seen.set(backend, terminal.getText().replace(/\s+/gu, " ").trim())
      } finally {
        await manager.stopAll()
      }
    }

    const [xterm, vterm] = [seen.get("xtermjs") ?? "", seen.get("vterm") ?? ""]
    expect(xterm).toContain(MARKER)
    expect(vterm).toContain(MARKER)
    // The load-bearing comparison: identical readable content. If this ever
    // fails, changing the default is NOT a safe cleanup and the failure names
    // exactly what a consumer would notice.
    expect(vterm).toBe(xterm)
  })
})
