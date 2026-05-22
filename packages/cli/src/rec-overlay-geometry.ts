/**
 * Live recording overlay — pure chrome geometry helpers.
 *
 * No silvery imports — pure functions + plain data types. Lets test files that
 * exercise the geometry math (chromeMetrics, computeLayout) run under
 * vanilla Node without dragging in silvery (which needs `AsyncDisposableStack`,
 * absent before Node 24).
 *
 * The downstream live-overlay component (`rec-live-overlay.tsx`) re-exports
 * these so existing callers (record-cmd, GIF chrome encoder, tests) need no
 * import-path changes when reaching for the geometry primitives — they can
 * import from either module.
 */

import type { ChromeStyle } from "../../../src/render/chrome.ts"

// ─────────────────────────────────────────────────────────────────────────────
// Chrome geometry — how many host rows / cols a given style adds around the
// grid. Centralised so the centering math agrees with the paint loop AND with
// the GIF encoder's separate chrome compositor.
// ─────────────────────────────────────────────────────────────────────────────

/** Pixel-accurate chrome dimensions for a given style. */
export interface ChromeMetrics {
  /** Top border + title bar row count (above the grid). */
  topRows: number
  /** Bottom border row count (below the grid). */
  bottomRows: number
  /** Left side column count (left border + inner padding). */
  leftCols: number
  /** Right side column count (right border + inner padding). */
  rightCols: number
  /** Show the host-rendered title bar? */
  showTitleBar: boolean
  /** Show macOS-style traffic-light dots in the title bar? */
  showDots: boolean
  /** Show Windows-style window controls (− □ ×) at the right of the title bar? */
  showControls: boolean
  /** Border style — single chars chosen from each preset. */
  border: {
    tl: string
    tr: string
    bl: string
    br: string
    h: string
    v: string
  } | null
}

/** Resolve {@link ChromeStyle} → {@link ChromeMetrics}. */
export function chromeMetrics(style: ChromeStyle): ChromeMetrics {
  switch (style) {
    case "macos":
      return {
        topRows: 2, // title bar (with dots) + top edge
        bottomRows: 1,
        leftCols: 1,
        rightCols: 1,
        showTitleBar: true,
        showDots: true,
        showControls: false,
        border: { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" },
      }
    case "windows":
      return {
        topRows: 2,
        bottomRows: 1,
        leftCols: 1,
        rightCols: 1,
        showTitleBar: true,
        showDots: false,
        showControls: true,
        border: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" },
      }
    case "none":
    default:
      return {
        topRows: 0,
        bottomRows: 0,
        leftCols: 0,
        rightCols: 0,
        showTitleBar: false,
        showDots: false,
        showControls: false,
        border: null,
      }
  }
}

/** Computed layout for one paint pass. */
export interface FrameLayout {
  hostCols: number
  hostRows: number
  /** 1-based row of the "● REC ..." status line. */
  statusRow: number
  /** 1-based row of the chrome's top border. */
  frameTop: number
  /** 1-based col of the chrome's left edge. */
  frameLeft: number
  /** Width of the chrome window (border included). */
  frameWidth: number
  /** Height of the chrome window (border included). */
  frameHeight: number
  /** 1-based row where the grid's first row lands. */
  gridTop: number
  /** 1-based col where the grid's first column lands. */
  gridLeft: number
  /** Visible columns of the grid (clipped to host). */
  visibleCols: number
  /** Visible rows of the grid (clipped to host). */
  visibleRows: number
}

/**
 * Compute the frame's host-terminal placement.
 *
 * Status line goes one row ABOVE the frame, padded to leave room. If the host
 * is too small to fit the framed grid, the visible region is clipped — the
 * frame still draws but the grid spills off the edge. Never returns negative
 * positions: in the degenerate case, the frame lands at (1, 1).
 */
export function computeLayout(
  hostCols: number,
  hostRows: number,
  gridCols: number,
  gridRows: number,
  metrics: ChromeMetrics,
): FrameLayout {
  const frameWidth = gridCols + metrics.leftCols + metrics.rightCols
  const frameHeight = gridRows + metrics.topRows + metrics.bottomRows
  // 1 row of margin between status line and frame; +1 row for the status itself.
  const statusReserve = 2

  const totalHeight = frameHeight + statusReserve
  const top = Math.max(1, Math.floor((hostRows - totalHeight) / 2) + 1)
  const statusRow = top
  const frameTop = top + statusReserve
  const frameLeft = Math.max(1, Math.floor((hostCols - frameWidth) / 2) + 1)
  const gridTop = frameTop + metrics.topRows
  const gridLeft = frameLeft + metrics.leftCols

  const visibleCols = Math.max(0, Math.min(gridCols, hostCols - (gridLeft - 1)))
  const visibleRows = Math.max(0, Math.min(gridRows, hostRows - (gridTop - 1) - metrics.bottomRows))

  return {
    hostCols,
    hostRows,
    statusRow,
    frameTop,
    frameLeft,
    frameWidth,
    frameHeight,
    gridTop,
    gridLeft,
    visibleCols,
    visibleRows,
  }
}
