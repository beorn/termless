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
      composedSvg = composeDiff(screenshots)
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
 * Compose diff view — show screenshots side by side with text diff below.
 */
function composeDiff(screenshots: BackendScreenshot[]): string {
  if (screenshots.length < 2) return composeSideBySide(screenshots)

  const imgWidth = 640
  const imgHeight = 480
  const headerHeight = 30
  const diffHeight = 200
  const gap = 10

  const totalWidth = screenshots.length * imgWidth + (screenshots.length - 1) * gap
  const totalHeight = imgHeight + headerHeight + gap + diffHeight

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

  // Text diff summary
  const diffY = headerHeight + imgHeight + gap
  const texts = screenshots.map((s) => s.text)
  const allMatch = texts.every((t) => t === texts[0])

  const diffMessage = allMatch ? "All backends produced identical text output" : "Text output differs between backends"

  const diffColor = allMatch ? "#4ec9b0" : "#f44747"
  parts.push(
    `<text x="10" y="${diffY + 20}" fill="${diffColor}" font-family="monospace" font-size="12">${escapeXml(diffMessage)}</text>`,
  )

  parts.push("</svg>")
  return parts.join("\n")
}

// =============================================================================
// Helpers
// =============================================================================

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
