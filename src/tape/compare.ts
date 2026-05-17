/**
 * Multi-backend tape comparison for termless.
 *
 * Runs the same .tape file against multiple backends and compares the results.
 * Supports separate screenshots, side-by-side composition, grid layout, and
 * pixel-level diff highlighting.
 *
 * @example
 * ```ts
 * import { parseTape, compareTape } from "@termless/core"
 *
 * const tape = parseTape(`Type "hello"\nEnter\nScreenshot`)
 * const result = await compareTape(tape, {
 *   backends: ["xtermjs", "vterm", "ghostty"],
 *   mode: "side-by-side",
 *   output: "./comparison.svg",
 * })
 * ```
 */

import type { TapeFile } from "./parser.ts"
import type { TerminalBackend } from "../types.ts"
import { executeTape, type TapeExecutorOptions } from "./executor.ts"
import { screenshotPng } from "../png.ts"

let upngModule: typeof import("upng-js") | null = null

// =============================================================================
// Types
// =============================================================================

export type CompareMode = "separate" | "side-by-side" | "grid" | "diff"

/** A backend specification: either a name string or a pre-created instance with a label. */
export type BackendSpec = string | { name: string; backend: TerminalBackend }

export interface CompareOptions {
  /** Backend names or instances to compare. */
  backends: BackendSpec[]
  /** How to present the comparison. */
  mode: CompareMode
  /** Output path for composed results (SVG/PNG). */
  output?: string
  /** Additional executor options passed to each backend run. */
  executorOptions?: Omit<TapeExecutorOptions, "backend">
}

export interface BackendScreenshot {
  /** Backend name. */
  backend: string
  /** PNG data from the final screenshot. */
  png: Uint8Array
  /** Terminal text content at time of screenshot. */
  text: string
}

export interface CompareResult {
  /** Individual backend screenshots. */
  screenshots: BackendScreenshot[]
  /** Composed SVG (for side-by-side, grid, diff modes). */
  composedSvg?: string
  /** Whether all backends produced identical output text. */
  textMatch: boolean
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Run a tape against multiple backends and compare the results.
 *
 * Each backend executes the full tape independently. After execution,
 * the results are composed according to the specified mode:
 *
 * - **separate**: individual screenshots per backend
 * - **side-by-side**: horizontal composition with backend name headers
 * - **grid**: arrange screenshots in a grid (2 columns)
 * - **diff**: highlight text differences between backends
 */
export async function compareTape(tape: TapeFile, options: CompareOptions): Promise<CompareResult> {
  const screenshots: BackendScreenshot[] = []

  // Run tape against each backend sequentially
  // (parallel would work but sequential is safer for resource-constrained systems)
  for (const spec of options.backends) {
    const backendOpt = typeof spec === "string" ? spec : spec.backend
    const backendLabel = typeof spec === "string" ? spec : spec.name
    const lastPng: Uint8Array[] = []

    const result = await executeTape(tape, {
      ...options.executorOptions,
      backend: backendOpt,
      onScreenshot: (png) => {
        lastPng.push(png)
      },
    })

    // If no explicit screenshot command, take one at the end
    let png: Uint8Array
    if (lastPng.length > 0) {
      png = lastPng[lastPng.length - 1]!
    } else {
      png = await screenshotPng(result.terminal)
    }

    const text = result.terminal.getText()

    screenshots.push({
      backend: backendLabel,
      png,
      text,
    })

    await result.terminal.close()
  }

  // Check text match
  const texts = screenshots.map((s) => s.text)
  const textMatch = texts.every((t) => t === texts[0])

  // Compose based on mode
  let composedSvg: string | undefined

  switch (options.mode) {
    case "separate":
      // No composition needed
      break

    case "side-by-side":
      composedSvg = composeSideBySide(screenshots)
      break

    case "grid":
      composedSvg = composeGrid(screenshots)
      break

    case "diff":
      composedSvg = await composeDiff(screenshots)
      break
  }

  return { screenshots, composedSvg, textMatch }
}

// =============================================================================
// SVG Composition
// =============================================================================

/**
 * Compose screenshots horizontally with backend name headers.
 * Generates a wrapper SVG that embeds individual PNGs as base64 images.
 */
function composeSideBySide(screenshots: BackendScreenshot[]): string {
  if (screenshots.length === 0) return "<svg></svg>"

  // Estimate dimensions (we don't have exact PNG dimensions without decoding,
  // so use reasonable defaults based on terminal size)
  const imgWidth = 640
  const imgHeight = 480
  const headerHeight = 30
  const gap = 10

  const totalWidth = screenshots.length * imgWidth + (screenshots.length - 1) * gap
  const totalHeight = imgHeight + headerHeight

  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}">`)
  parts.push(`<rect width="100%" height="100%" fill="#1e1e1e"/>`)

  for (let i = 0; i < screenshots.length; i++) {
    const x = i * (imgWidth + gap)
    const s = screenshots[i]!
    const b64 = uint8ArrayToBase64(s.png)

    // Header
    parts.push(
      `<text x="${x + imgWidth / 2}" y="20" text-anchor="middle" fill="#d4d4d4" font-family="monospace" font-size="14">${escapeXml(s.backend)}</text>`,
    )

    // Image
    parts.push(
      `<image x="${x}" y="${headerHeight}" width="${imgWidth}" height="${imgHeight}" href="data:image/png;base64,${b64}"/>`,
    )
  }

  parts.push("</svg>")
  return parts.join("\n")
}

/**
 * Compose screenshots in a grid layout (2 columns).
 */
function composeGrid(screenshots: BackendScreenshot[]): string {
  if (screenshots.length === 0) return "<svg></svg>"

  const imgWidth = 640
  const imgHeight = 480
  const headerHeight = 30
  const gap = 10
  const gridCols = 2

  const gridRows = Math.ceil(screenshots.length / gridCols)
  const totalWidth = gridCols * imgWidth + (gridCols - 1) * gap
  const totalHeight = gridRows * (imgHeight + headerHeight + gap)

  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}">`)
  parts.push(`<rect width="100%" height="100%" fill="#1e1e1e"/>`)

  for (let i = 0; i < screenshots.length; i++) {
    const col = i % gridCols
    const row = Math.floor(i / gridCols)
    const x = col * (imgWidth + gap)
    const y = row * (imgHeight + headerHeight + gap)
    const s = screenshots[i]!
    const b64 = uint8ArrayToBase64(s.png)

    parts.push(
      `<text x="${x + imgWidth / 2}" y="${y + 20}" text-anchor="middle" fill="#d4d4d4" font-family="monospace" font-size="14">${escapeXml(s.backend)}</text>`,
    )
    parts.push(
      `<image x="${x}" y="${y + headerHeight}" width="${imgWidth}" height="${imgHeight}" href="data:image/png;base64,${b64}"/>`,
    )
  }

  parts.push("</svg>")
  return parts.join("\n")
}

/**
 * Compose diff view — show screenshots side by side with pixel diff overlays below.
 */
async function composeDiff(screenshots: BackendScreenshot[]): Promise<string> {
  if (screenshots.length < 2) return composeSideBySide(screenshots)

  const imgWidth = 640
  const imgHeight = 480
  const headerHeight = 30
  const diffHeaderHeight = 50
  const gap = 10
  const baseline = screenshots[0]!
  const overlays = await Promise.all(screenshots.slice(1).map((s) => createPixelDiffOverlay(baseline, s)))

  const screenshotWidth = screenshots.length * imgWidth + (screenshots.length - 1) * gap
  const overlayWidth = overlays.length * imgWidth + Math.max(0, overlays.length - 1) * gap
  const totalWidth = Math.max(screenshotWidth, overlayWidth)
  const overlayY = headerHeight + imgHeight + gap + diffHeaderHeight
  const totalHeight = overlayY + imgHeight

  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}">`)
  parts.push(`<rect width="100%" height="100%" fill="#1e1e1e"/>`)

  // Screenshots
  for (let i = 0; i < screenshots.length; i++) {
    const x = i * (imgWidth + gap)
    const s = screenshots[i]!
    const b64 = uint8ArrayToBase64(s.png)

    parts.push(
      `<text x="${x + imgWidth / 2}" y="20" text-anchor="middle" fill="#d4d4d4" font-family="monospace" font-size="14">${escapeXml(s.backend)}</text>`,
    )
    parts.push(
      `<image x="${x}" y="${headerHeight}" width="${imgWidth}" height="${imgHeight}" href="data:image/png;base64,${b64}"/>`,
    )
  }

  const diffY = headerHeight + imgHeight + gap
  const texts = screenshots.map((s) => s.text)
  const allMatch = texts.every((t) => t === texts[0])

  const diffMessage = allMatch ? "All backends produced identical text output" : "Text output differs between backends"

  const diffColor = allMatch ? "#4ec9b0" : "#f44747"
  parts.push(
    `<text x="10" y="${diffY + 20}" fill="${diffColor}" font-family="monospace" font-size="12">${escapeXml(diffMessage)}</text>`,
  )

  for (let i = 0; i < overlays.length; i++) {
    const overlay = overlays[i]!
    const x = i * (imgWidth + gap)
    const b64 = uint8ArrayToBase64(overlay.png)
    const changedPct = ((overlay.diffPixels / overlay.totalPixels) * 100).toFixed(2)
    const label = `Pixel diff vs ${baseline.backend}: ${overlay.backend} — ${overlay.diffPixels}/${overlay.totalPixels} changed pixels (${changedPct}%)`

    parts.push(
      `<text x="${x + imgWidth / 2}" y="${overlayY - 14}" text-anchor="middle" fill="#d4d4d4" font-family="monospace" font-size="12">${escapeXml(label)}</text>`,
    )
    parts.push(
      `<image data-diff-overlay="true" x="${x}" y="${overlayY}" width="${imgWidth}" height="${imgHeight}" href="data:image/png;base64,${b64}"/>`,
    )
  }

  parts.push("</svg>")
  return parts.join("\n")
}

// =============================================================================
// Helpers
// =============================================================================

interface DecodedPng {
  width: number
  height: number
  rgba: Uint8Array
}

interface PixelDiffOverlay {
  backend: string
  png: Uint8Array
  diffPixels: number
  totalPixels: number
}

async function loadUpng() {
  if (upngModule) return upngModule
  try {
    upngModule = await import("upng-js")
    return upngModule
  } catch {
    throw new Error("diff comparison requires upng-js. Install it:\n  bun add upng-js")
  }
}

async function decodePng(data: Uint8Array): Promise<DecodedPng> {
  const UPNG = await loadUpng()
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  const decoded = UPNG.decode(buffer)
  const frame = UPNG.toRGBA8(decoded)[0]
  if (!frame) {
    throw new Error("PNG decode produced no RGBA frame")
  }
  return {
    width: decoded.width,
    height: decoded.height,
    rgba: new Uint8Array(frame),
  }
}

async function createPixelDiffOverlay(
  baseline: BackendScreenshot,
  target: BackendScreenshot,
): Promise<PixelDiffOverlay> {
  const UPNG = await loadUpng()
  const [a, b] = await Promise.all([decodePng(baseline.png), decodePng(target.png)])
  const width = Math.max(a.width, b.width)
  const height = Math.max(a.height, b.height)
  const output = new Uint8Array(width * height * 4)
  let diffPixels = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const outIndex = (y * width + x) * 4
      const inA = x < a.width && y < a.height
      const inB = x < b.width && y < b.height
      const aIndex = (y * a.width + x) * 4
      const bIndex = (y * b.width + x) * 4
      const same =
        inA &&
        inB &&
        a.rgba[aIndex] === b.rgba[bIndex] &&
        a.rgba[aIndex + 1] === b.rgba[bIndex + 1] &&
        a.rgba[aIndex + 2] === b.rgba[bIndex + 2] &&
        a.rgba[aIndex + 3] === b.rgba[bIndex + 3]

      if (!same) {
        diffPixels++
        output[outIndex] = 255
        output[outIndex + 1] = 0
        output[outIndex + 2] = 255
        output[outIndex + 3] = 220
      }
    }
  }

  const png = UPNG.encode([output.buffer as ArrayBuffer], width, height, 0)
  return {
    backend: target.backend,
    png: new Uint8Array(png),
    diffPixels,
    totalPixels: width * height,
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function uint8ArrayToBase64(data: Uint8Array): string {
  // Use Buffer if available (Node.js/Bun), otherwise manual encoding
  if (typeof Buffer !== "undefined") {
    return Buffer.from(data).toString("base64")
  }
  let binary = ""
  for (const byte of data) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}
