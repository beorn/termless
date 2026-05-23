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
  clampGridToHost,
  resolveLiveChrome,
  DEFAULT_GRID_COLS,
  DEFAULT_GRID_ROWS,
  MIN_GRID_COLS,
  MIN_GRID_ROWS,
} from "../src/rec-live-overlay.tsx"

// Post-B2 the overlay creates its own XtermAdapter internally (from
// the cols/rows opts) — the pre-B2 fakeTerm() stub is gone. The tests
// here verify only the public handle surface (start/stop, idempotency,
// no throws); full component rendering is covered by silvery's own
// `viewport-mvp.test.tsx`.

describe("startRecLiveOverlay — public handle", () => {
  it("returns a handle with the documented shape", () => {
    const out = makeMockStream()
    const handle = startRecLiveOverlay({
      out,
      chromeStyle: "none",
      hostCols: () => 80,
      hostRows: () => 24,
      cols: 80,
      rows: 24,
    })
    expect(typeof handle.feed).toBe("function")
    expect(typeof handle.rerender).toBe("function")
    expect(typeof handle.repaint).toBe("function")
    expect(typeof handle.setElapsedMs).toBe("function")
    expect(typeof handle.stop).toBe("function")
    handle.stop()
  })

  it("stop() is idempotent", () => {
    const out = makeMockStream()
    const handle = startRecLiveOverlay({
      out,
      chromeStyle: "none",
      hostCols: () => 80,
      hostRows: () => 24,
      cols: 80,
      rows: 24,
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
    const handle = startRecLiveOverlay({
      out,
      chromeStyle: "none",
      hostCols: () => 80,
      hostRows: () => 24,
      cols: 80,
      rows: 24,
    })
    // No mouse-mode enable should be present.
    expect(out.written.some((s) => /\x1b\[\?(?:1000|1002|1003|1006)h/.test(s))).toBe(false)
    handle.stop()
    // Nor a blanket disable on stop — record-cmd's snooper handles both.
    // We still expect alt-screen exit + cursor-show as the safety net.
    expect(out.written.some((s) => s.includes("\x1b[?1049l"))).toBe(true)
    expect(out.written.some((s) => s.includes("\x1b[?25h"))).toBe(true)
  })

  it("feed / rerender / setElapsedMs / repaint do not throw before silvery mounts", () => {
    const out = makeMockStream()
    const handle = startRecLiveOverlay({
      out,
      chromeStyle: "none",
      hostCols: () => 80,
      hostRows: () => 24,
      cols: 80,
      rows: 24,
    })
    expect(() => {
      handle.feed("hello world\r\n")
      handle.feed(new Uint8Array([0x41, 0x42, 0x43]))
      handle.rerender()
      handle.repaint()
      handle.setElapsedMs(1500)
    }).not.toThrow()
    handle.stop()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Recorded-grid size — fixed 80×30 default + letterbox (15614).
//
// Per user verdict 2026-05-22 #undead reopen of 15589: the recorded grid is
// the fixed DEFAULT_GRID (80×30) at wider hosts (letterboxed inside the
// host), and clamps DOWN only when the host can't fit it. The grid NEVER
// GROWS to fill a wider host (size-fit is OUT — explicitly rejected). The
// chrome box is therefore always ≤ the host viewport (no host-scrollback
// bleed), and the recorded program always sees a stable 80×30 PTY at any
// host ≥ 80×30. These are pure functions — no TTY, no silvery mount needed.
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

describe("clampGridToHost — fixed 80×30 default + letterbox + clamp-down", () => {
  it("returns the DEFAULT_GRID (80×30) when the host comfortably fits it", () => {
    // host 120×40 minus macos chrome (2×5) = 118×35 available. The grid
    // STAYS AT 80×30 (clamped from above by DEFAULT_GRID, not from
    // below). The chrome box is then letterboxed inside the host.
    expect(clampGridToHost(120, 40, "macos")).toEqual({ cols: 80, rows: 30 })
  })

  it("returns DEFAULT_GRID at a very wide host (220×60) — never grows past 80×30", () => {
    // Size-fit (rejected) would have given 218×55 here. The user
    // verdict is unambiguous: grid stays at 80×30, letterboxed.
    expect(clampGridToHost(220, 60, "macos")).toEqual({ cols: 80, rows: 30 })
  })

  it("clamps DOWN at a host narrower than DEFAULT_GRID + chrome (80×24)", () => {
    // host 80×24 minus macos chrome (2×5) = 78×19 available. The grid
    // clamps down to 78×19 — the chrome box fits the host with no
    // overflow. (The fixed default of 80×30 cannot fit at this host.)
    expect(clampGridToHost(80, 24, "macos")).toEqual({ cols: 78, rows: 19 })
  })

  it("none chrome at 80×30 host yields DEFAULT_GRID (chrome row overhead absorbed)", () => {
    // host 80×30 minus none chrome (0×2) = 80×28 available. Default
    // 80×30 cols fit; rows clamp to 28 (host shorter than default).
    expect(clampGridToHost(80, 30, "none")).toEqual({ cols: 80, rows: 28 })
  })

  it("clamps to MIN_GRID floor when the host is tiny — never 0 or negative", () => {
    // A 10×4 host minus chrome would be negative; the PTY must never
    // be spawned at ≤ 0 cols/rows (ConPTY + many apps hard-crash).
    const grid = clampGridToHost(10, 4, "macos")
    expect(grid.cols).toBe(MIN_GRID_COLS)
    expect(grid.rows).toBe(MIN_GRID_ROWS)
    expect(grid.cols).toBeGreaterThan(0)
    expect(grid.rows).toBeGreaterThan(0)
  })

  it("the grid NEVER exceeds DEFAULT_GRID — invariant (user-decided, 15614)", () => {
    // The "never grows past the default" invariant — the core user
    // contract. Pre-15614 size-fit violated this; this invariant pins it.
    for (const style of ["macos", "windows", "none"] as const) {
      for (const [h, v] of [
        [80, 30],
        [120, 40],
        [220, 60],
        [400, 200],
      ]) {
        const grid = clampGridToHost(h!, v!, style)
        expect(grid.cols).toBeLessThanOrEqual(DEFAULT_GRID_COLS)
        expect(grid.rows).toBeLessThanOrEqual(DEFAULT_GRID_ROWS)
      }
    }
  })

  it("the chrome box always fits the host viewport (no overflow, by construction)", () => {
    // For any host ≥ the chrome+floor minimum, grid + chromeOverhead ≤ host.
    // This invariant survives the 15614 rule shift — what changed is HOW
    // grid is bounded from above (DEFAULT vs host); the chrome box never
    // overflowing the host is still the property that prevents 15589.
    for (const style of ["macos", "windows", "none"] as const) {
      const oh = chromeOverhead(style)
      for (const [h, v] of [
        [80, 30],
        [120, 40],
        [100, 50],
        [200, 60],
      ]) {
        const grid = clampGridToHost(h!, v!, style)
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
type MockStream = {
  written: string[]
  columns: number
  rows: number
  isTTY: false
  fd: number
  write(data: string | Uint8Array): boolean
  on(): MockStream
  off(): MockStream
  removeListener(): MockStream
  removeAllListeners(): MockStream
}

function makeMockStream(): NodeJS.WriteStream & { written: string[] } {
  const written: string[] = []
  // Explicit `MockStream` type breaks the TS7022 self-reference cycle —
  // before the explicit type, `on(): typeof stream` referenced `stream`
  // while it was still being initialized, making the inferred type
  // collapse to `any`. The named alias gives `stream` a declared type
  // up-front so the recursive returns resolve cleanly.
  const stream: MockStream = {
    written,
    columns: 80,
    rows: 24,
    isTTY: false,
    fd: 1,
    write(data: string | Uint8Array): boolean {
      written.push(typeof data === "string" ? data : Buffer.from(data).toString("utf8"))
      return true
    },
    on(): MockStream {
      return stream
    },
    off(): MockStream {
      return stream
    },
    removeListener(): MockStream {
      return stream
    },
    removeAllListeners(): MockStream {
      return stream
    },
  }
  return stream as unknown as NodeJS.WriteStream & { written: string[] }
}
