/**
 * @failure  a CLI or MCP consumer that does not name a backend silently gets
 *   xterm.js — the retired differential reference — instead of vterm, the
 *   production engine, and is told a cursor is visible when the app hid it
 * @level    l1 — real SessionManager, feed-only, no PTY
 * @consumer @pm/22783-i15-workspace-usability Track 2 — @chief's ruling of
 *   2026-08-04: "change the session default to vterm ... leaving xterm as the
 *   `default:` branch means every consumer who does not name a backend
 *   silently gets the retired engine."
 *
 * ## Why this is a behavioural test and not a source assertion
 *
 * The sibling guest-seam guards (`rec-live-overlay-vterm-guest.test.ts`,
 * `tools/inhab-watch-vterm-guest.test.ts`) pin an IMPORT, because there the two
 * guests are drop-in and nothing observable distinguishes them. Here the
 * opposite is true: the backends are distinguishable at runtime, so the
 * stronger assertion is available and is the one worth making. A source grep
 * for `"vterm"` would also pass if the string moved into a comment.
 *
 * ## Choosing a discriminator, and one that was rejected
 *
 * `session-backend-differential.test.ts` deliberately proves the two backends
 * are IDENTICAL on readable text — so text cannot answer "which backend is
 * this". A discriminator has to come from where they genuinely disagree.
 * Measured at this seam before writing the test:
 *
 * - **DECTCEM** (`ESC[?25l`, hide cursor) — xterm reports `visible: true`,
 *   vterm reports `visible: false`. Discriminates.
 * - **DECSCUSR** (`ESC[6 q`, bar cursor) — xterm hardcodes `style: "block"`,
 *   vterm reports `"beam"`. Discriminates.
 * - **Fancy underline** (`SGR 4:4`) — REJECTED. Both backends report
 *   `underline: "dotted"` correctly here. The documented collapse to plain is
 *   a property of the xterm *guest adapter* translating into Silvery's `Cell`
 *   vocabulary, NOT of the xterm backend. Using it would have produced a test
 *   that passes under both backends and therefore asserts nothing.
 *
 * ## Why the xterm control assertion is not redundant
 *
 * The default-is-vterm test alone would still pass if someone taught the xterm
 * backend to report the cursor truthfully — the discriminator would be dead and
 * the test would be vacuous while looking green. The control pins the
 * divergence itself, so that change breaks the control (a loud, accurate
 * failure naming exactly what happened) instead of silently hollowing out the
 * test above it.
 */

import { describe, expect, test } from "vitest"
import { createSessionManager } from "../src/session.ts"

/** Hide the cursor (DECTCEM reset), then request a bar cursor (DECSCUSR 6). */
const HIDE_CURSOR = "\x1b[?25l"
const BAR_CURSOR = "\x1b[6 q"

async function cursorAfterProbe(backend?: "xtermjs" | "vterm"): Promise<{ visible: boolean; style: string }> {
  const manager = createSessionManager()
  try {
    const { terminal } = await manager.createSession(backend ? { backend } : {})
    terminal.feed(HIDE_CURSOR)
    terminal.feed(BAR_CURSOR)
    const cursor = terminal.getCursor()
    return { visible: cursor.visible, style: cursor.style }
  } finally {
    await manager.stopAll()
  }
}

describe("session manager default backend (@pm/22783 Track 2)", () => {
  test("a consumer that names no backend gets vterm's truthful cursor reporting", async () => {
    const unnamed = await cursorAfterProbe()

    // Both are things vterm reports faithfully and xterm.js flattens.
    expect(unnamed.visible).toBe(false) // the app hid the cursor; say so
    expect(unnamed.style).toBe("beam") // the app asked for a bar; say so
  })

  test("naming vterm explicitly is indistinguishable from naming nothing", async () => {
    // The default is not merely "some backend that happens to pass" — it is
    // the same backend a caller gets by asking for it by name.
    expect(await cursorAfterProbe()).toEqual(await cursorAfterProbe("vterm"))
  })

  test("control: xterm.js still flattens both, so the assertions above discriminate", async () => {
    const xterm = await cursorAfterProbe("xtermjs")

    // If either of these ever fails, the discriminator is gone and the two
    // tests above have quietly become vacuous — fix them, do not delete this.
    expect(xterm.visible).toBe(true) // hidden cursor reported visible anyway
    expect(xterm.style).toBe("block") // bar cursor reported as a block anyway
  })
})
