/**
 * @failure  peekaboo's DATA path runs xterm.js, so `getCursor()` reports a
 *   visible block cursor for an app that hid the cursor and asked for a beam —
 *   and peekaboo exists to be believed about what a real terminal shows
 * @level    l1 — real peekaboo backend, visual:false, no OS automation, no PTY
 * @consumer @pm/22783-i15-workspace-usability Track 2 class 3 — @chief's ruling
 *   of 2026-08-04: "PEEKABOO → VTERM: GO, as a small slice."
 *
 * ## Why this was NOT settled by the session.ts ruling
 *
 * peekaboo is a separate product, and Track 2's rule for separate products is
 * to rule on merit rather than sweep. The evidence that decided it: peekaboo
 * uses an emulator ONLY as its data path (`getText`/`getCell`/`getCursor`)
 * behind a real terminal app — the same `TerminalBackend` seam `session.ts`
 * uses, where the differential is already proven. That is the opposite of
 * `@termless/web-player`, which calls `terminal.open(element)` and structurally
 * cannot use vterm because vterm has no DOM renderer. web-player's keep is
 * structural; peekaboo's was not, which is why this one moves.
 *
 * ## Why cursor state is the assertion
 *
 * Text is not a discriminator — the backend differential
 * (`packages/cli/tests/session-backend-differential.test.ts`) deliberately
 * proves both emulators surface identical readable text. The two disagree on
 * cursor shape and visibility (D3/D4), where vterm reports what the terminal
 * actually said and the xterm adapter hardcodes `block` and `visible`.
 *
 * That divergence matters more here than anywhere else in the codebase.
 * peekaboo's whole purpose is to be authoritative about what a real terminal
 * app is doing; a data path that reports a visible block cursor for a hidden
 * beam is confidently wrong about exactly the thing peekaboo is consulted for.
 *
 * ## Scope: this runs everywhere, unlike the rest of peekaboo
 *
 * `visual: false` means no window, no osascript, no screencapture — the data
 * path is pure JS and runs on Linux and CI. peekaboo's OS-automation tests are
 * macOS-gated `.slow` files; this one is neither, on purpose, because the
 * backend swap it guards has nothing to do with the operating system.
 */

import { describe, expect, test } from "vitest"
import { createPeekabooBackend } from "../src/backend.ts"

/** Hide the cursor (DECTCEM reset), then ask for a bar cursor (DECSCUSR 6). */
const HIDE_AND_BEAM = "\x1b[?25l\x1b[6 q"

function feed(backend: { feed: (d: Uint8Array) => void }, s: string): void {
  backend.feed(new TextEncoder().encode(s))
}

describe("peekaboo data path runs the production engine (@pm/22783 Track 2)", () => {
  test("reports a hidden cursor as hidden, and a beam as a beam", () => {
    const backend = createPeekabooBackend({ visual: false })
    try {
      backend.init({ cols: 40, rows: 5 })
      feed(backend, HIDE_AND_BEAM)

      const cursor = backend.getCursor()
      // Both are things vterm reports faithfully and the xterm adapter hardcodes.
      expect(cursor.visible).toBe(false)
      expect(cursor.style).toBe("beam")
    } finally {
      backend.destroy()
    }
  })

  test("the data path still reads text, so the swap did not trade one job for another", () => {
    // The guard above would pass against a backend that reported cursor state
    // correctly and nothing else. peekaboo's primary data job is text.
    const backend = createPeekabooBackend({ visual: false })
    try {
      backend.init({ cols: 40, rows: 5 })
      feed(backend, "peekaboo-data-path")
      expect(backend.getText()).toContain("peekaboo-data-path")
    } finally {
      backend.destroy()
    }
  })
})
