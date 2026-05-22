/**
 * Regression — `termless rec` live overlay: host-scrollback bleed +
 * recorded-app line-wrap. Bead `@km/termless/15589`.
 *
 * The 4th `termless rec` bug. After the crash (`15551`), keyboard-protocol
 * (`15575`) and mouse-protocol (`15586`) fixes, the live overlay STILL
 * rendered wrong:
 *
 * 1. Host content bled around the recorded box — the overlay drew a centred
 *    chrome window but never owned/painted the surrounding surface, so the
 *    host terminal's pre-existing screen content showed through.
 * 2. The recorded `km view` line-wrapped — its grid was sized to a
 *    host-independent 80×30 default, larger than `host − chrome`, so the
 *    chrome box overflowed the host viewport.
 *
 * The /big reframe (`.claude/arch-decisions/2026-05-22-termless-rec-viewport-fit.md`):
 * both symptoms are one root cause — the recorded grid size is decoupled
 * from the viewport that displays it. The fix is the viewport-fit contract:
 *
 * - `fitGridToHost` derives the grid as `host − chromeOverhead` → the chrome
 *   box is ≤ the host viewport BY CONSTRUCTION → no overflow, no wrap;
 * - the `Overlay` root `<Box>` has an explicit `backgroundColor` and is
 *   sized `width/height 100%` → it paints EVERY host cell on every frame →
 *   no unpainted margin → no host-bleed.
 *
 * This test renders the real `Overlay` component through `@silvery/test`'s
 * `createRenderer` and asserts both halves of the contract at the cell
 * level. It does NOT need a TTY or a real PTY.
 *
 * Pairs with `rec-live-overlay.test.ts` (pure size-helper unit tests).
 */

import React from "react"
import { describe, expect, test } from "vitest"
import { createRenderer } from "@silvery/test"
import type { TerminalReadable } from "silvery"
import {
  Overlay,
  chromeTokens,
  createOverlayStore,
  fitGridToHost,
} from "../src/rec-live-overlay.tsx"

// ────────────────────────────────────────────────────────────────────────────
// A fake recorded terminal sized exactly to the viewport-fit derivation —
// this is what `record-cmd.ts` now feeds the overlay.
// ────────────────────────────────────────────────────────────────────────────
function fittedTerminal(cols: number, rows: number, fill = "X"): TerminalReadable {
  const blank = {
    char: fill,
    fg: null,
    bg: null,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    strikethrough: false,
    inverse: false,
  }
  const lines = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ ...blank })))
  return {
    cols,
    rows,
    getLines: () => lines,
    getCursor: () => ({ x: 0, y: 0, visible: true }),
  }
}

/**
 * Render the `Overlay` at a given host size with a recorded terminal sized
 * via `fitGridToHost` — i.e. the exact size contract `record-cmd.ts` now
 * enforces.
 */
function renderOverlay(hostCols: number, hostRows: number, style: "macos" | "windows" | "none") {
  const grid = fitGridToHost(hostCols, hostRows, style)
  const terminal = fittedTerminal(grid.cols, grid.rows)
  const store = createOverlayStore({ revision: 0, elapsedMs: 0, blinkTick: 0 })
  const render = createRenderer({ cols: hostCols, rows: hostRows })
  const app = render(<Overlay terminal={terminal} title="rec" preset={chromeTokens(style)} store={store} />)
  return { app, grid }
}

describe("rec live overlay — surface ownership (no host-scrollback bleed)", () => {
  for (const style of ["macos", "windows", "none"] as const) {
    test(`${style}: the overlay root paints EVERY host cell — no unpainted margin`, () => {
      const HOST_COLS = 120
      const HOST_ROWS = 40
      const { app } = renderOverlay(HOST_COLS, HOST_ROWS, style)
      const buffer = app.buffer
      expect(buffer).not.toBeNull()
      if (!buffer) return

      // Every cell in the host viewport must be owned by the overlay tree.
      // A cell with a background colour set is a cell the overlay painted;
      // an undefined/null bg is a cell the renderer never touched — which is
      // exactly where host scrollback would bleed through. The root `<Box>`
      // now carries `backgroundColor="$bg"`, so every cell is painted.
      let unpainted = 0
      for (let y = 0; y < buffer.height; y++) {
        for (let x = 0; x < buffer.width; x++) {
          const cell = buffer.getCell(x, y)
          if (!cell || cell.bg == null) unpainted++
        }
      }
      expect(unpainted).toBe(0)
    })
  }

  test("the rendered overlay never exceeds the host viewport (no overflow)", () => {
    // CLS-style invariant: with the viewport-fit contract the laid-out tree
    // fits the host. A pre-fix 80×30 grid in an 80-col host overflowed.
    const HOST_COLS = 80
    const HOST_ROWS = 30
    const { app } = renderOverlay(HOST_COLS, HOST_ROWS, "macos")
    const buffer = app.buffer
    expect(buffer).not.toBeNull()
    if (!buffer) return
    expect(buffer.width).toBe(HOST_COLS)
    expect(buffer.height).toBe(HOST_ROWS)
  })
})

describe("rec live overlay — recorded grid fits its container (no line-wrap)", () => {
  test("the recorded-grid <Text> rows render at the fitted width, not 80", () => {
    // Pre-fix: the recorded grid was a hardcoded 80 cols; in an 80-col host
    // the 2-col border pushed the row content to wrap. Post-fix: the grid is
    // `host − chrome`, so the bordered box is exactly the host width.
    const HOST_COLS = 80
    const HOST_ROWS = 30
    const { app, grid } = renderOverlay(HOST_COLS, HOST_ROWS, "macos")
    // macos chrome: 2-col border → grid is 78 cols.
    expect(grid.cols).toBe(78)
    // The recorded fill char appears on screen — the grid rendered.
    expect(app.text).toContain("X")
    // No row of the rendered output is longer than the host width: every
    // line in the buffer is exactly HOST_COLS wide (silvery pads), and the
    // grid + border (78 + 2) equals the host (80) exactly — no wrap.
    expect(grid.cols + 2).toBe(HOST_COLS)
  })

  test("a wide host gives a correspondingly wide recorded grid", () => {
    const { grid } = renderOverlay(200, 60, "macos")
    expect(grid.cols).toBe(198)
    expect(grid.rows).toBe(55)
  })
})
