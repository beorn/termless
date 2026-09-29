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
 * The surviving guest-seam guard, `rec-live-overlay-vterm-guest.test.ts`, pins
 * an IMPORT because its two guests are drop-in and nothing observable
 * distinguishes them. Here the opposite is true: the backends are
 * distinguishable at runtime, so the stronger assertion is available and is
 * the one worth making. A source grep
 * for `"vterm"` would also pass if the string moved into a comment.
 *
 * ## Choosing a discriminator, and one that was rejected
 *
 * `session-backend-differential.test.ts` deliberately proves the two backends
 * are IDENTICAL on readable text — so text cannot answer "which backend is
 * this". A discriminator has to come from where they genuinely disagree.
 * Measured at this seam before writing the test:
 *
 * - **DECTCEM** (`ESC[?25l`, hide cursor) — both now report `visible: false`.
 *   This checks cursor truth but cannot identify the selected backend.
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
 * The default-is-vterm test alone would still pass if xterm learned the bar
 * cursor shape. The control pins the remaining style divergence so that the
 * backend-selection assertion cannot silently become vacuous.
 */

import { describe, expect, test } from "vitest"
import { createSessionManager } from "../src/session.ts"

/** Hide the cursor (DECTCEM reset), then request a bar cursor (DECSCUSR 6). */
const HIDE_CURSOR = "\x1b[?25l"
const BAR_CURSOR = "\x1b[6 q"

/**
 * `visible` and `style` are nullable on the backend contract — a backend is
 * allowed to not know. Kept nullable here rather than narrowed at the boundary,
 * so that "reported nothing" stays distinguishable from "reported false", which
 * is exactly the distinction these tests turn on.
 */
async function cursorAfterProbe(
  backend?: "xtermjs" | "vterm",
): Promise<{ visible: boolean | null; style: string | null }> {
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

    // Visibility checks the user-facing result; shape identifies the backend.
    expect(unnamed.visible).toBe(false) // the app hid the cursor; say so
    expect(unnamed.style).toBe("beam") // the app asked for a bar; say so
  })

  test("naming vterm explicitly is indistinguishable from naming nothing", async () => {
    // The default is not merely "some backend that happens to pass" — it is
    // the same backend a caller gets by asking for it by name.
    expect(await cursorAfterProbe()).toEqual(await cursorAfterProbe("vterm"))
  })

  test("control: xterm.js still reports a block cursor, so shape identifies vterm", async () => {
    const xterm = await cursorAfterProbe("xtermjs")

    // If this changes, the shape discriminator above must be reconsidered.
    expect(xterm.style).toBe("block")
  })
})
