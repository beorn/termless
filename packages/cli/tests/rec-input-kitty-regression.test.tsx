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
type MockTtyStream = {
  written: string[]
  columns: number
  rows: number
  isTTY: true
  fd: number
  write(data: string | Uint8Array): boolean
  on(): MockTtyStream
  off(): MockTtyStream
  once(): MockTtyStream
  removeListener(): MockTtyStream
  removeAllListeners(): MockTtyStream
  listenerCount(): number
}

function makeTtyMockStream(): NodeJS.WriteStream & { written: string[] } {
  const written: string[] = []
  // Explicit `MockTtyStream` type breaks the TS7022 self-reference cycle —
  // before the explicit type, `on(): typeof stream` referenced `stream` while
  // it was still being initialized, making the return type `any`. The named
  // alias gives `stream` a declared type up-front so the recursive references
  // resolve cleanly.
  const stream: MockTtyStream = {
    written,
    columns: 80,
    rows: 24,
    isTTY: true,
    fd: 1,
    write(data: string | Uint8Array): boolean {
      written.push(typeof data === "string" ? data : Buffer.from(data).toString("utf8"))
      return true
    },
    on(): MockTtyStream {
      return stream
    },
    off(): MockTtyStream {
      return stream
    },
    once(): MockTtyStream {
      return stream
    },
    removeListener(): MockTtyStream {
      return stream
    },
    removeAllListeners(): MockTtyStream {
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

/**
 * Mouse-tracking ENABLE — any of the SGR / motion private modes
 * (`CSI ?1000h` / `?1002h` / `?1003h` / `?1006h` / `?1016h`).
 */
const MOUSE_ENABLE_RE = /\x1b\[\?(?:1000|1002|1003|1006|1016)h/

/** CSI ?1004h — focus-event reporting ENABLE. */
const FOCUS_ENABLE_RE = /\x1b\[\?1004h/

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

/**
 * Regression — `termless rec` overlay must NOT enable mouse tracking or
 * focus reporting on the host terminal.
 *
 * Bug `@km/termless/15586-rec-mouse-garble`: after the 15575 Kitty-keyboard
 * fix the recording *still* garbled. Cause: mouse tracking and focus
 * reporting are also host-input-protocol toggles — `CSI ?1000h`/`?1002h`/
 * `?1003h`/`?1006h` makes the terminal emit mouse-report bytes on stdin,
 * `CSI ?1004h` makes it emit focus-event bytes. The 15575 fix deliberately
 * left both unchanged; that was the residual leak. With `input: false`
 * silvery does not own stdin, so it must not enable them — host
 * mouse/focus-report sequences the recorded child cannot parse leak to the
 * screen as garbled text.
 *
 * The fix (silvery `create-app.tsx`): the mouse-tracking enable, the
 * focus-reporting enable, and their teardown disables are all gated by
 * `!inputDisabled`, the sibling gate to 15575's Kitty fix.
 */
describe("rec overlay — mouse/focus tracking must stay off (input: false)", () => {
  it("never writes a mouse-enable sequence to the host", async () => {
    const out = makeTtyMockStream()
    const handle = startRecLiveOverlay(fakeTerm(), {
      out,
      chromeStyle: "none",
      hostCols: () => 80,
      hostRows: () => 24,
    })

    await new Promise((r) => setTimeout(r, 250))

    const all = out.written.join("")
    expect(
      MOUSE_ENABLE_RE.test(all),
      `host stdout must not contain a mouse-enable sequence ` +
        `(CSI ?1000/1002/1003/1006h); got: ${JSON.stringify(all.slice(0, 200))}`,
    ).toBe(false)

    handle.stop()
  })

  it("never writes a focus-enable sequence to the host", async () => {
    const out = makeTtyMockStream()
    const handle = startRecLiveOverlay(fakeTerm(), {
      out,
      chromeStyle: "none",
      hostCols: () => 80,
      hostRows: () => 24,
    })

    await new Promise((r) => setTimeout(r, 250))

    const all = out.written.join("")
    expect(
      FOCUS_ENABLE_RE.test(all),
      `host stdout must not contain a focus-enable sequence (CSI ?1004h); ` +
        `got: ${JSON.stringify(all.slice(0, 200))}`,
    ).toBe(false)

    handle.stop()
  })
})
