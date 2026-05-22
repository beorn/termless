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
import {
  startRecLiveOverlay,
  chromeOverhead,
  fitGridToHost,
  resolveLiveChrome,
  MIN_GRID_COLS,
  MIN_GRID_ROWS,
} from "../src/rec-live-overlay.tsx"
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
// Viewport-fit contract — `@km/termless/15589`. The recorded grid MUST be
// `host − chromeOverhead`, so the chrome box is always ≤ the host viewport
// (no host-scrollback bleed) and the grid never overflows (no line-wrap).
// These are pure functions — no TTY, no silvery mount needed.
// ────────────────────────────────────────────────────────────────────────────

describe("chromeOverhead — the size-contract source of truth", () => {
  it("macos/windows reserve a bordered box + title bar + status line", () => {
    // 2 cols border; 1 status + 1 spacer + 2 border + 1 titlebar = 5 rows.
    expect(chromeOverhead("macos")).toEqual({ cols: 2, rows: 5 })
    expect(chromeOverhead("windows")).toEqual({ cols: 2, rows: 5 })
  })

  it("none reserves only the status bar + spacer (no border)", () => {
    expect(chromeOverhead("none")).toEqual({ cols: 0, rows: 2 })
  })
})

describe("fitGridToHost — recorded grid = host − chrome", () => {
  it("derives the grid from host minus chrome overhead (macos)", () => {
    // The km default terminal is 80×30 — the exact size that overflowed
    // before the fix (80-col grid + 2-col border = 82 > 80-col host).
    expect(fitGridToHost(80, 30, "macos")).toEqual({ cols: 78, rows: 25 })
  })

  it("a 120×40 host yields a comfortably large grid", () => {
    expect(fitGridToHost(120, 40, "macos")).toEqual({ cols: 118, rows: 35 })
  })

  it("none chrome loses only the status bar + spacer rows", () => {
    expect(fitGridToHost(80, 30, "none")).toEqual({ cols: 80, rows: 28 })
  })

  it("clamps to the usable floor when the host is tiny — never 0 or negative", () => {
    // A 10×4 host minus chrome would be negative; the PTY must never be
    // spawned at ≤ 0 cols/rows (ConPTY + many apps hard-crash).
    const fitted = fitGridToHost(10, 4, "macos")
    expect(fitted.cols).toBe(MIN_GRID_COLS)
    expect(fitted.rows).toBe(MIN_GRID_ROWS)
    expect(fitted.cols).toBeGreaterThan(0)
    expect(fitted.rows).toBeGreaterThan(0)
  })

  it("the chrome box always fits the host viewport (no overflow, by construction)", () => {
    // For any host ≥ the chrome+floor minimum, grid + chromeOverhead ≤ host.
    for (const style of ["macos", "windows", "none"] as const) {
      const oh = chromeOverhead(style)
      for (const [h, v] of [
        [80, 30],
        [120, 40],
        [100, 50],
        [200, 60],
      ]) {
        const grid = fitGridToHost(h!, v!, style)
        expect(grid.cols + oh.cols).toBeLessThanOrEqual(h!)
        expect(grid.rows + oh.rows).toBeLessThanOrEqual(v!)
      }
    }
  })
})

describe("resolveLiveChrome — auto-drop chrome when the host is too small", () => {
  it("keeps the requested chrome when the host comfortably fits it", () => {
    expect(resolveLiveChrome(120, 40, "macos")).toBe("macos")
    expect(resolveLiveChrome(80, 30, "windows")).toBe("windows")
  })

  it("downgrades to none when the host can't fit a bordered box + min grid", () => {
    // host − chromeOverhead("macos") would fall below the min grid floor.
    expect(resolveLiveChrome(21, 30, "macos")).toBe("none")
    expect(resolveLiveChrome(80, 8, "macos")).toBe("none")
  })

  it("none is already minimal — never downgrades further", () => {
    expect(resolveLiveChrome(5, 3, "none")).toBe("none")
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
