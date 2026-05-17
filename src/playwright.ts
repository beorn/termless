/**
 * Optional Playwright screenshot renderer for termless.
 *
 * The default PNG path uses @resvg/resvg-js and stays fast/deterministic.
 * This renderer is for docs, marketing, and visual-review screenshots where
 * browser text shaping and installed browser fonts are useful enough to pay
 * the Chromium startup cost.
 */

import { screenshotSvg } from "./svg.ts"
import type {
  PlaywrightBrowserLike,
  PlaywrightModuleLike,
  PlaywrightScreenshotOptions,
  TerminalReadable,
} from "./types.ts"

interface SvgDimensions {
  width: number
  height: number
}

let playwrightModule: PlaywrightModuleLike | null = null

async function loadPlaywright(): Promise<PlaywrightModuleLike> {
  if (playwrightModule) return playwrightModule

  try {
    const moduleName = "playwright"
    playwrightModule = (await import(moduleName)) as PlaywrightModuleLike
    return playwrightModule
  } catch (cause) {
    throw new Error(
      "screenshotPlaywrightPng() requires the optional playwright package. Install it:\n" + "  bun add -d playwright",
      { cause },
    )
  }
}

function parseSvgDimensions(svg: string): SvgDimensions {
  const width = svg.match(/\bwidth="([^"]+)"/)?.[1]
  const height = svg.match(/\bheight="([^"]+)"/)?.[1]
  const parsedWidth = Number(width)
  const parsedHeight = Number(height)

  if (!Number.isFinite(parsedWidth) || !Number.isFinite(parsedHeight)) {
    throw new Error("Unable to read SVG dimensions for Playwright screenshot rendering")
  }

  return { width: parsedWidth, height: parsedHeight }
}

function viewportSize({ width, height }: SvgDimensions): { width: number; height: number } {
  return {
    width: Math.max(1, Math.ceil(width)),
    height: Math.max(1, Math.ceil(height)),
  }
}

function renderHtml(svg: string, { width, height }: SvgDimensions): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      html, body {
        margin: 0;
        padding: 0;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: transparent;
      }
      svg {
        display: block;
      }
    </style>
  </head>
  <body>${svg}</body>
</html>`
}

function resolveScale(scale: number | undefined): number {
  const resolved = scale ?? 2
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new Error(`Playwright screenshot scale must be a positive finite number, got ${scale}`)
  }
  return resolved
}

function asUint8Array(bytes: Uint8Array | ArrayBuffer): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
}

/**
 * Render a terminal screenshot as PNG via Playwright/Chromium.
 *
 * Playwright is optional. Pass `options.playwright` to inject an already-loaded
 * module in tests or controlled environments; otherwise this loads
 * `playwright` lazily and throws a clear install hint when it is absent.
 */
export async function screenshotPlaywrightPng(
  terminal: TerminalReadable,
  options?: PlaywrightScreenshotOptions,
): Promise<Uint8Array> {
  const svg = screenshotSvg(terminal, options)
  const dimensions = parseSvgDimensions(svg)
  const scale = resolveScale(options?.scale)
  const playwright = options?.playwright ?? (await loadPlaywright())
  let browser: PlaywrightBrowserLike
  try {
    browser = await playwright.chromium.launch(options?.launchOptions)
  } catch (cause) {
    throw new Error(
      "screenshotPlaywrightPng() could not launch Chromium. If Playwright browsers are missing, install them:\n" +
        "  bunx playwright install chromium",
      { cause },
    )
  }

  try {
    const page = await browser.newPage({
      viewport: viewportSize(dimensions),
      deviceScaleFactor: scale,
    })
    await page.setContent(renderHtml(svg, dimensions), { waitUntil: "load" })
    await page.evaluate?.(() => document.fonts.ready.then(() => undefined))
    return asUint8Array(await page.screenshot({ type: "png" }))
  } finally {
    await browser.close()
  }
}
