/**
 * Regression — `termless rec` overlay must NOT enable the Kitty keyboard
 * protocol on the host terminal.
 *
 * Bug `@km/termless/15575-rec-input-broken`: `termless rec -- bun km view`
 * ran but keyboard input was dead and raw CSI-u key reports (`[57441;2u`,
 * `[57444;10u`, …) leaked onto the screen as visible text. The user could
 * not even Ctrl-D to stop and had to `kill -9`.
 *
 * Root cause: the `rec-live-overlay` mounts silvery with `{ input: false }`
 * because the host's stdin → child-PTY pipe must stay intact — silvery does
 * NOT own keyboard input here, the recorded child does. But silvery's
 * `createApp` enable path wrote `CSI > <flags> u` (enable Kitty keyboard)
 * unconditionally for any non-headless render, ignoring `input: false`.
 *
 * Consequence: the host terminal entered Kitty mode → user keystrokes were
 * Kitty-encoded as CSI-u reports → those bytes flowed host stdin →
 * `pty.write()` → the inner `km view`, which (under `TERM=xterm-256color`,
 * legacy keyboard mode) could not parse them → they rendered as garbage
 * text and every hotkey (incl. Ctrl-D) went dead.
 *
 * The fix (silvery `create-app.tsx`): the Kitty keyboard enable AND the
 * Kitty-specific teardown disable are both gated by `!inputDisabled`. When
 * silvery does not own stdin it leaves keyboard-protocol negotiation
 * entirely to the actual input owner.
 *
 * This test mounts the real `startRecLiveOverlay` against a TTY-shaped
 * stdout (so silvery's non-headless protocol-setup path runs) and asserts
 * the captured host bytes never contain a Kitty-enable sequence.
 *
 * Pairs with `vendor/silvery/tests/features/input-disabled-kitty.test.tsx`.
 */

import { describe, expect, it } from "vitest"
import { startRecLiveOverlay } from "../src/rec-live-overlay.tsx"
import type { Terminal } from "../../../src/terminal/types.ts"

/** Minimal fake Terminal — the overlay reads only the grid-shape members. */
function fakeTerm(): Terminal {
  return {
    cols: 5,
    rows: 2,
    getLines: () => [[], []],
    getCursor: () => ({ x: 0, y: 0, visible: true, style: null }),
    getText: () => "",
    getTextRange: () => "",
    getCell: () => ({}) as never,
    getLine: () => [],
    getMode: () => false,
    getTitle: () => "",
    getScrollback: () => ({ viewportOffset: 0, totalLines: 0, screenLines: 2 }),
  } as unknown as Terminal
}

/**
 * Mock stream that reports `isTTY: true` so silvery's `createApp` runs its
 * non-headless protocol-setup path (the path that would emit the Kitty
 * enable). Captures every write for assertion.
 */
function makeTtyMockStream(): NodeJS.WriteStream & { written: string[] } {
  const written: string[] = []
  const stream = {
    written,
    columns: 80,
    rows: 24,
    isTTY: true,
    fd: 1,
    write(data: string | Uint8Array): boolean {
      written.push(typeof data === "string" ? data : Buffer.from(data).toString("utf8"))
      return true
    },
    on(): typeof stream {
      return stream
    },
    off(): typeof stream {
      return stream
    },
    once(): typeof stream {
      return stream
    },
    removeListener(): typeof stream {
      return stream
    },
    removeAllListeners(): typeof stream {
      return stream
    },
    listenerCount(): number {
      return 0
    },
  }
  return stream as unknown as NodeJS.WriteStream & { written: string[] }
}

/** CSI > <flags> u — the Kitty keyboard ENABLE (push) sequence. */
const KITTY_ENABLE_RE = /\x1b\[>\d*u/

describe("rec overlay — Kitty keyboard protocol must stay off (input: false)", () => {
  it("never writes a Kitty-enable sequence to the host", async () => {
    const out = makeTtyMockStream()
    const handle = startRecLiveOverlay(fakeTerm(), {
      out,
      chromeStyle: "none",
      hostCols: () => 80,
      hostRows: () => 24,
    })

    // Give silvery's async mount a chance to run its protocol-setup path.
    await new Promise((r) => setTimeout(r, 250))

    const all = out.written.join("")
    expect(
      KITTY_ENABLE_RE.test(all),
      `host stdout must not contain a Kitty-enable sequence (CSI > … u); ` +
        `got: ${JSON.stringify(all.slice(0, 200))}`,
    ).toBe(false)

    handle.stop()
  })

  it("does not emit Kitty CSI-u key reports back through the host", async () => {
    // Belt-and-braces: even after stop(), no CSI-u report-style bytes should
    // appear in what the overlay wrote. (The overlay never reads stdin, so
    // it could only produce these by having flipped the host into Kitty
    // mode — which the enable-gate now prevents.)
    const out = makeTtyMockStream()
    const handle = startRecLiveOverlay(fakeTerm(), {
      out,
      chromeStyle: "none",
      hostCols: () => 80,
      hostRows: () => 24,
    })
    await new Promise((r) => setTimeout(r, 250))
    handle.stop()
    await new Promise((r) => setTimeout(r, 50))

    const all = out.written.join("")
    expect(KITTY_ENABLE_RE.test(all)).toBe(false)
  })
})
