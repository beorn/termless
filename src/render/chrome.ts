/**
 * Window-chrome presets for rendered terminal screenshots.
 *
 * `record` exposes a single `--chrome <style>` knob; this module turns that
 * one word into the bundle of {@link SvgScreenshotOptions} fields the SVG
 * renderer needs (window bar, border radius, margin, drop shadow). Keeping the
 * preset logic here — not inline in the CLI — means the GIF / PNG / SVG paths,
 * the `--keys` still path, and any future consumer all resolve a preset the
 * same way.
 *
 * - `none` — no chrome. Byte-identical to today's output (the renderer's
 *   no-chrome fast path).
 * - `macos` — rounded top corners, three filled traffic-light dots, a soft
 *   drop shadow, and a small transparent margin so the shadow has room.
 * - `windows` — a flat title bar with minimize / maximize / close glyphs;
 *   square corners, no shadow (the Windows convention).
 */

import type { SvgScreenshotOptions } from "../terminal/types.ts"

/**
 * Geometry of a chrome'd terminal screenshot in CSS pixels — where the cell
 * grid sits inside the framed window. Consumers that need to composite a
 * cell-native rasterization (swash) under chrome layer call this to learn
 * (a) the chrome layer's full dimensions and (b) the (x,y) offset at which to
 * blit the cell-grid bitmap.
 */
export interface ChromeBounds {
  /** Total chrome'd SVG width in CSS px (innerWidth + margin*2). */
  totalWidth: number
  /** Total chrome'd SVG height in CSS px (innerHeight + margin*2). */
  totalHeight: number
  /** Cell-grid origin X in CSS px (margin + padding). */
  cellOffsetX: number
  /** Cell-grid origin Y in CSS px (margin + padding + windowBarSize). */
  cellOffsetY: number
  /** Cell-grid width in CSS px (cols * cellWidth). */
  cellAreaWidth: number
  /** Cell-grid height in CSS px (rows * cellHeight). */
  cellAreaHeight: number
}

/**
 * Compute the chrome layout geometry for `style` at a `cols × rows` cell grid.
 * Mirrors the math in `screenshotSvg`'s chrome path — kept here so consumers
 * (e.g. the GIF compositor) can size and offset their cell-native rasters
 * without parsing the rendered SVG.
 */
export function chromeBounds(
  style: ChromeStyle,
  cols: number,
  rows: number,
  cellWidth: number,
  cellHeight: number,
): ChromeBounds {
  const opts = chromeOptions(style)
  const padding = opts.padding ?? 0
  const margin = opts.margin ?? 0
  const barHeight = opts.windowBar && opts.windowBar !== "none" ? (opts.windowBarSize ?? 0) : 0
  const cellAreaWidth = cols * cellWidth
  const cellAreaHeight = rows * cellHeight
  const innerWidth = cellAreaWidth + padding * 2
  const innerHeight = cellAreaHeight + padding * 2 + barHeight
  return {
    totalWidth: innerWidth + margin * 2,
    totalHeight: innerHeight + margin * 2,
    cellOffsetX: margin + padding,
    cellOffsetY: margin + padding + barHeight,
    cellAreaWidth,
    cellAreaHeight,
  }
}

/** The window-chrome styles `--chrome` accepts. */
export const CHROME_STYLES = ["none", "macos", "windows"] as const

/** A window-chrome style name. */
export type ChromeStyle = (typeof CHROME_STYLES)[number]

/** Type guard — true when `value` is a recognised {@link ChromeStyle}. */
export function isChromeStyle(value: string): value is ChromeStyle {
  return (CHROME_STYLES as readonly string[]).includes(value)
}

/**
 * Resolve a `--chrome` style (plus an optional title) into the SVG-renderer
 * options that draw that chrome. `none` returns `{}` — no options touched, so
 * the renderer takes its byte-identical no-chrome fast path.
 *
 * @param style  The chrome style. Unknown values resolve as `none`.
 * @param title  Optional title text shown in the window bar.
 */
export function chromeOptions(style: ChromeStyle, title?: string): SvgScreenshotOptions {
  switch (style) {
    case "macos":
      return {
        windowBar: "colorful",
        windowBarSize: 38,
        borderRadius: 10,
        // Generous, even inner padding (~3 cells) so the terminal grid sits
        // centered inside a comfortably-sized window with breathing room —
        // not a frame shrink-wrapped to the text.
        padding: 28,
        // The margin gives the drop shadow room to render without clipping.
        margin: 24,
        shadow: 14,
        ...(title ? { windowTitle: title } : {}),
      }
    case "windows":
      return {
        windowBar: "windows",
        windowBarSize: 34,
        // Generous, even inner padding (~2.5 cells) — the grid centered with
        // breathing room inside the window.
        padding: 24,
        // Square corners + no shadow — the Windows desktop convention.
        borderRadius: 0,
        margin: 0,
        ...(title ? { windowTitle: title } : {}),
      }
    case "none":
    default:
      return {}
  }
}
