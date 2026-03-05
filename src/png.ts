/**
 * PNG screenshot renderer for termless.
 *
 * Renders the terminal as SVG via screenshotSvg(), then rasterizes to PNG
 * using @resvg/resvg-js (optional dependency). Throws a clear error if
 * @resvg/resvg-js is not installed.
 */

import type { TerminalReadable, SvgScreenshotOptions } from "./types.ts"
import { screenshotSvg } from "./svg.ts"

export interface PngScreenshotOptions extends SvgScreenshotOptions {
  /** Render scale factor (default: 2 for retina-quality output). */
  scale?: number
}

// Lazy-cached import of @resvg/resvg-js
let resvgModule: { Resvg: any } | null = null

async function loadResvg() {
  if (resvgModule) return resvgModule
  try {
    resvgModule = await import("@resvg/resvg-js")
    return resvgModule
  } catch {
    throw new Error("screenshotPng() requires @resvg/resvg-js. Install it:\n" + "  bun add -d @resvg/resvg-js")
  }
}

/**
 * Render a terminal screenshot as a PNG buffer.
 *
 * Requires `@resvg/resvg-js` as an optional dependency:
 *   bun add -d @resvg/resvg-js
 */
export async function screenshotPng(terminal: TerminalReadable, options?: PngScreenshotOptions): Promise<Uint8Array> {
  const svg = screenshotSvg(terminal, options)
  const scale = options?.scale ?? 2

  const { Resvg } = await loadResvg()

  const resvg = new Resvg(svg, {
    fitTo: { mode: "zoom" as const, value: scale },
  })
  return resvg.render().asPng()
}
