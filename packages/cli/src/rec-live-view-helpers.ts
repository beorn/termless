/**
 * Pure helpers for {@link RecorderLive} — kept in a separate file from the
 * React component so they can be unit-tested without dragging
 * `react` / `silvery` / `@silvery/ag-react` into the test's module graph.
 *
 * Standalone CI clones cannot resolve `@silvery/ag-react`'s JSX-without-React
 * source files (silvery 0.4.x packaging quirk) — pulling the React reconciler
 * in via a transitive import would break the test. Isolating the pure logic
 * here keeps the test fast, deterministic, and standalone-safe.
 */

import type { Cell } from "../../../src/terminal/types.ts"
import type { ChromeStyle } from "../../../src/render/chrome.ts"

/** Border + chrome accent for a {@link ChromeStyle}. */
export interface ChromePresentation {
  /** Silvery `borderStyle` value, or `null` to omit the border. */
  borderStyle: "round" | "single" | "double" | null
  /** Show the title-bar row above the grid? */
  showTitleBar: boolean
  /** Show the macOS-style traffic-light dots in the title bar? */
  showDots: boolean
}

/** Compute chrome-presentation flags for a {@link ChromeStyle}. */
export function chromePresentation(style: ChromeStyle): ChromePresentation {
  switch (style) {
    case "macos":
      return { borderStyle: "round", showTitleBar: true, showDots: true }
    case "windows":
      return { borderStyle: "single", showTitleBar: true, showDots: false }
    case "none":
    default:
      return { borderStyle: null, showTitleBar: false, showDots: false }
  }
}

/**
 * Render a row of {@link Cell}s as a single string. Wide-cell continuation
 * cells are skipped — the preceding wide cell already contributed its glyph.
 * Falls back to a single space for empty cells.
 */
export function rowToString(row: readonly Cell[], cols: number): string {
  let out = ""
  for (let c = 0; c < cols; c++) {
    const cell = row[c]
    if (!cell) {
      out += " "
      continue
    }
    if (cell.continuation) continue
    out += cell.char || " "
  }
  return out
}
