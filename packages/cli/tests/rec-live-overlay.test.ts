/**
 * rec-live-overlay — public API tests.
 *
 * The geometry-math primitives (`chromeMetrics`, `computeLayout`) from the
 * previous direct-ANSI painter are gone — silvery owns layout now. These
 * tests cover the public surface (`startRecLiveOverlay`, the
 * `RecLiveOverlayHandle`) without trying to spin up a full silvery render
 * pipeline in a non-TTY test environment. The component-level rendering
 * is covered by `vendor/silvery/tests/features/terminal-component.test.tsx`.
 */

import { describe, it, expect } from "vitest"
import { startRecLiveOverlay } from "../src/rec-live-overlay.tsx"
import type { Terminal } from "../../../src/terminal/types.ts"

// Minimal fake Terminal stub for the smoke test. The overlay's silvery
// mount may fail in a non-TTY test environment (no real stdout), so the
// tests only verify the handle surface — start/stop, idempotency, no
// throws when called against the fake.
function fakeTerm(): Terminal {
  return {
    cols: 5,
    rows: 2,
    getLines: () => [[], []],
    getCursor: () => ({ x: 0, y: 0, visible: true, style: null }),
    // The remaining TerminalReadable members aren't read by <Terminal>.
    getText: () => "",
    getTextRange: () => "",
    getCell: () => ({}) as never,
    getLine: () => [],
    getMode: () => false,
    getTitle: () => "",
    getScrollback: () => ({ viewportOffset: 0, totalLines: 0, screenLines: 2 }),
  } as unknown as Terminal
}

describe("startRecLiveOverlay — public handle", () => {
  it("returns a handle with the documented shape", () => {
    const out = makeMockStream()
    const handle = startRecLiveOverlay(fakeTerm(), {
      out,
      chromeStyle: "none",
      hostCols: () => 80,
      hostRows: () => 24,
    })
    expect(typeof handle.rerender).toBe("function")
    expect(typeof handle.repaint).toBe("function")
    expect(typeof handle.setElapsedMs).toBe("function")
    expect(typeof handle.stop).toBe("function")
    handle.stop()
  })

  it("stop() is idempotent", () => {
    const out = makeMockStream()
    const handle = startRecLiveOverlay(fakeTerm(), {
      out,
      chromeStyle: "none",
      hostCols: () => 80,
      hostRows: () => 24,
    })
    handle.stop()
    // Second call must not throw.
    expect(() => handle.stop()).not.toThrow()
  })

  it("does NOT unconditionally enable host mouse mode (snoop-driven only)", () => {
    // record-cmd.ts snoops PTY output and mirrors the recorded program's
    // mouse-mode escapes to the host. The overlay must NOT add a blanket
    // `\x1b[?1003h` at startup — that's the bug upstream `8d293a5` fixed.
    const out = makeMockStream()
    const handle = startRecLiveOverlay(fakeTerm(), {
      out,
      chromeStyle: "none",
      hostCols: () => 80,
      hostRows: () => 24,
    })
    // No mouse-mode enable should be present.
    expect(out.written.some((s) => /\x1b\[\?(?:1000|1002|1003|1006)h/.test(s))).toBe(false)
    handle.stop()
    // Nor a blanket disable on stop — record-cmd's snooper handles both.
    // We still expect alt-screen exit + cursor-show as the safety net.
    expect(out.written.some((s) => s.includes("\x1b[?1049l"))).toBe(true)
    expect(out.written.some((s) => s.includes("\x1b[?25h"))).toBe(true)
  })

  it("rerender / setElapsedMs / repaint do not throw before silvery mounts", () => {
    const out = makeMockStream()
    const handle = startRecLiveOverlay(fakeTerm(), {
      out,
      chromeStyle: "none",
      hostCols: () => 80,
      hostRows: () => 24,
    })
    expect(() => {
      handle.rerender()
      handle.repaint()
      handle.setElapsedMs(1500)
    }).not.toThrow()
    handle.stop()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Mock stream — captures writes so the tests can assert on host bytes
// without actually emitting to a real stdout.
// ────────────────────────────────────────────────────────────────────────────
function makeMockStream(): NodeJS.WriteStream & { written: string[] } {
  const written: string[] = []
  const stream = {
    written,
    columns: 80,
    rows: 24,
    isTTY: false,
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
    removeListener(): typeof stream {
      return stream
    },
    removeAllListeners(): typeof stream {
      return stream
    },
  }
  return stream as unknown as NodeJS.WriteStream & { written: string[] }
}
