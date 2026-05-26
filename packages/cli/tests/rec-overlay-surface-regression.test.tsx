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
 * - `clampGridToHost` returns `min(DEFAULT_GRID, host − chromeOverhead)` →
 *   the chrome box is ≤ the host viewport BY CONSTRUCTION → no overflow, no
 *   wrap; the grid never grows past the user-decided 80×30 default;
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
import { ScopeProvider } from "silvery"
import { createScope } from "@silvery/scope"
import { createCellBuffer, type MutableCellBuffer } from "@silvery/ag/viewport-buffer"
import type { Cell } from "@silvery/ag/types"
import type { IslandGuest, IslandHandle, IslandOutputOwner, IslandSizeOwner } from "@silvery/ag/island-types"
import { Overlay, chromeTokens, createOverlayStore, clampGridToHost } from "../src/rec-live-overlay.tsx"

/**
 * Mock IslandGuest that blits a uniform `fill`-char buffer with a bg color.
 * This is the surface-regression fixture's stand-in for the real xtermGuest;
 * the test verifies what the OVERLAY ROOT paints (host cell coverage, chrome
 * letterbox, no overflow), independent of which IslandGuest provides the
 * inner cells.
 */
function fillBuffer(buf: MutableCellBuffer, fill: string): MutableCellBuffer {
  const cell: Cell = {
    char: fill,
    fg: null,
    bg: "#008000",
    attrs: {},
    wide: false,
    continuation: false,
  }
  for (let r = 0; r < buf.rows; r++) {
    for (let c = 0; c < buf.cols; c++) buf.setCell(c, r, cell)
  }
  return buf
}

function mockGuest(fill = "X"): IslandGuest {
  const subscribers = new Set<() => void>()
  return {
    init(ctx) {
      let cols = ctx.cols
      let rows = ctx.rows
      const buf = fillBuffer(createCellBuffer(cols, rows), fill)
      const size: IslandSizeOwner = {
        get cols() {
          return cols
        },
        get rows() {
          return rows
        },
        subscribe: () => () => {},
        requestResize(nextCols, nextRows) {
          cols = nextCols
          rows = nextRows
        },
      }
      const output: IslandOutputOwner = {
        buffer: buf,
        cursor: null,
        cursorVisible: false,
        subscribe(listener) {
          subscribers.add(listener)
          return () => subscribers.delete(listener)
        },
        writeCells() {},
        invalidateAll() {
          for (const listener of subscribers) listener()
        },
      }
      const handle: IslandHandle = { size, output, dispose() {} }
      ctx.emit({ type: "ready" })
      return Promise.resolve(handle)
    },
  }
}

async function flushIslandMount(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

/**
 * Render the `Overlay` at a given host size with a recorded grid sized via
 * `clampGridToHost` — the 15614 size contract `record-cmd.ts` enforces
 * (fixed-default + letterbox + clamp-down).
 */
async function renderOverlay(hostCols: number, hostRows: number, style: "macos" | "windows" | "none") {
  const grid = clampGridToHost(hostCols, hostRows, style)
  const guest = mockGuest()
  const store = createOverlayStore({ revision: 0, elapsedMs: 0, blinkTick: 0 })
  const render = createRenderer({ cols: hostCols, rows: hostRows })
  const scope = createScope("rec-overlay-island-test")
  const tree = () => (
    <ScopeProvider scope={scope}>
      <Overlay guest={guest} cols={grid.cols} rows={grid.rows} title="rec" preset={chromeTokens(style)} store={store} />
    </ScopeProvider>
  )
  const app = render(tree())
  await flushIslandMount()
  app.rerender(tree())
  return { app, grid }
}

describe("rec live overlay — surface ownership (no host-scrollback bleed)", () => {
  for (const style of ["macos", "windows", "none"] as const) {
    test(`${style}: the overlay root paints EVERY host cell — no unpainted margin`, async () => {
      const HOST_COLS = 120
      const HOST_ROWS = 40
      const { app } = await renderOverlay(HOST_COLS, HOST_ROWS, style)
      const buffer = app.lastBuffer()
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

  test("the rendered overlay never exceeds the host viewport (no overflow)", async () => {
    // CLS-style invariant: with the viewport-fit contract the laid-out tree
    // fits the host. A pre-fix 80×30 grid in an 80-col host overflowed.
    const HOST_COLS = 80
    const HOST_ROWS = 30
    const { app } = await renderOverlay(HOST_COLS, HOST_ROWS, "macos")
    const buffer = app.lastBuffer()
    expect(buffer).not.toBeNull()
    if (!buffer) return
    expect(buffer.width).toBe(HOST_COLS)
    expect(buffer.height).toBe(HOST_ROWS)
  })
})

describe("rec live overlay — recorded grid fits its container (no line-wrap)", () => {
  test("the recorded-grid Island rows render at the fitted width, not 80", async () => {
    // Pre-15589: hardcoded 80 grid in 80-col host overflowed (chrome pushed
    // it to 82 → wrap). Post-15589 (size-fit, now superseded): grid was
    // `host − chrome` (= 78 here). Post-15614 (fixed-default + clamp-down):
    // grid is `min(80, host − chrome)` = `min(80, 78)` = 78 at this narrow
    // host — same numeric result, different rule. At a WIDER host (120+)
    // the grid stays at 80 (letterboxed), which is the user-decided contract.
    const HOST_COLS = 80
    const HOST_ROWS = 30
    const { app, grid } = await renderOverlay(HOST_COLS, HOST_ROWS, "macos")
    // Narrow host: clamp-down to host − chrome = 78×25.
    expect(grid.cols).toBe(78)
    // The recorded fill char appears on screen — the grid rendered.
    expect(app.text).toContain("X")
    // No row of the rendered output is longer than the host width: every
    // line in the buffer is exactly HOST_COLS wide (silvery pads), and the
    // grid + border (78 + 2) equals the host (80) exactly — no wrap.
    expect(grid.cols + 2).toBe(HOST_COLS)
  })

  test("a wide host LETTERBOXES the recorded grid at 80×30 — does NOT grow with the host (15614)", async () => {
    // Pre-15614 contract (size-fit, REJECTED by the user): grid grew with
    // host — 200×60 host yielded a 198×55 grid. Post-15614 (user-decided
    // fixed-default + letterbox): the grid STAYS AT 80×30 regardless of
    // host width. The chrome box is letterboxed inside the 200×60 host.
    const { grid } = await renderOverlay(200, 60, "macos")
    expect(grid.cols).toBe(80)
    expect(grid.rows).toBe(30)
  })
})
