/**
 * The **Renderer strategy** — `buffer → pixels`.
 *
 * A Renderer rasterizes a terminal buffer into a presentable artifact (SVG
 * vector text, PNG raster, or — via `@termless/ghostty` — a canvas-rendered
 * PNG). It is a *strategy*, not a domain object: the recording domain has
 * three nouns (Backend · Terminal · Recording) and four verbs (record · view ·
 * play · compare); the Renderer is an internal capability used by `record`
 * (frame capture) and `view` (per-frame display).
 *
 * There is no `Renderer` class hierarchy and no presentation-side noun for it.
 * A Renderer is just a function — `(terminal, options) => artifact` — and this
 * module collects the built-in strategies behind one import surface:
 *
 * - {@link screenshotSvg} — synchronous vector strategy (no native deps)
 * - {@link screenshotPng} — raster strategy via `@resvg/resvg-js`
 * - `@termless/ghostty`'s `renderTerminalPng` — canvas raster strategy
 *   (lives in the ghostty package but conforms to {@link RasterRenderer})
 *
 * Swapping the strategy is what satisfies the cross-platform ambition: a
 * canvas/DOM target plugs in here without the three domain objects moving.
 */

import type { TerminalReadable } from "../terminal/types.ts"

export { screenshotSvg, rgbToHex, rgbToString } from "./svg.ts"
export { screenshotPng } from "./png.ts"
export type { PngScreenshotOptions } from "./png.ts"

/**
 * A **vector** Renderer strategy: a synchronous `buffer → SVG string`
 * rasterizer. {@link screenshotSvg} is the built-in implementation.
 */
export type VectorRenderer<O = unknown> = (terminal: TerminalReadable, options?: O) => string

/**
 * A **raster** Renderer strategy: an async `buffer → PNG bytes` rasterizer.
 * Both {@link screenshotPng} and `@termless/ghostty`'s `renderTerminalPng`
 * conform to this shape.
 */
export type RasterRenderer<O = unknown> = (terminal: TerminalReadable, options?: O) => Promise<Uint8Array>

/**
 * The Renderer strategy in either form. `record` and `view` accept a
 * `Renderer` and never care which concrete strategy was supplied.
 */
export type Renderer<O = unknown> = VectorRenderer<O> | RasterRenderer<O>
