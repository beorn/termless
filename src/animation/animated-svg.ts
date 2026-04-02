/**
 * Animated SVG encoder for termless.
 *
 * Composes multiple SVG frames into a single animated SVG using CSS keyframe
 * animations. Each frame becomes a `<g>` element with opacity toggled via
 * `@keyframes` — at any given time exactly one frame is visible.
 *
 * The output is a self-contained SVG that animates in any modern browser.
 */

import type { AnimationFrame, AnimationOptions } from "./types.ts"

/** Extract the inner content of an SVG element (everything between <svg ...> and </svg>). */
function stripSvgWrapper(svg: string): string {
  // Remove the opening <svg ...> tag
  const openEnd = svg.indexOf(">")
  if (openEnd === -1) return svg
  let inner = svg.slice(openEnd + 1)

  // Remove the closing </svg> tag
  const closeStart = inner.lastIndexOf("</svg>")
  if (closeStart !== -1) {
    inner = inner.slice(0, closeStart)
  }

  return inner.trim()
}

/** Parse width and height from an SVG element's attributes. */
function parseSvgDimensions(svg: string): { width: number; height: number } {
  const widthMatch = svg.match(/width="([^"]+)"/)
  const heightMatch = svg.match(/height="([^"]+)"/)
  return {
    width: widthMatch ? Number(widthMatch[1]) : 100,
    height: heightMatch ? Number(heightMatch[1]) : 50,
  }
}

/**
 * Compose multiple SVG frames into a single animated SVG.
 *
 * Uses CSS `@keyframes` to toggle frame visibility via opacity.
 * Each frame displays for its specified duration, then the next
 * frame takes over. The animation loops according to `options.loop`.
 */
export function createAnimatedSvg(frames: AnimationFrame[], options?: AnimationOptions): string {
  if (frames.length === 0) {
    throw new Error("createAnimatedSvg requires at least one frame")
  }

  const defaultDuration = options?.defaultDuration ?? 100
  const loop = options?.loop ?? 0
  const iterationCount = loop === 0 ? "infinite" : String(loop)

  const { width, height } = parseSvgDimensions(frames[0]!.svg)

  // Single frame — no animation needed
  if (frames.length === 1) {
    const content = stripSvgWrapper(frames[0]!.svg)
    return [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`, content, `</svg>`].join(
      "\n",
    )
  }

  // Calculate total duration and cumulative timing
  const durations = frames.map((f) => f.duration || defaultDuration)
  const totalDuration = durations.reduce((sum, d) => sum + d, 0)
  const totalSeconds = totalDuration / 1000

  // Build CSS keyframes for each frame
  const styleLines: string[] = []
  let cumulativeTime = 0

  for (let i = 0; i < frames.length; i++) {
    const startPct = (cumulativeTime / totalDuration) * 100
    const endPct = ((cumulativeTime + durations[i]!) / totalDuration) * 100

    // Each frame is visible (opacity 1) during its window, invisible otherwise.
    // Use a tiny gap (0.01%) for the transition to avoid two frames being visible.
    const keyframes: string[] = []

    if (startPct > 0) {
      keyframes.push(`0% { opacity: 0 }`)
      keyframes.push(`${startPct.toFixed(2)}% { opacity: 0 }`)
    } else {
      keyframes.push(`0% { opacity: 1 }`)
    }

    if (startPct > 0) {
      keyframes.push(`${(startPct + 0.01).toFixed(2)}% { opacity: 1 }`)
    }

    keyframes.push(`${endPct.toFixed(2)}% { opacity: 1 }`)

    if (endPct < 100) {
      keyframes.push(`${(endPct + 0.01).toFixed(2)}% { opacity: 0 }`)
      keyframes.push(`100% { opacity: 0 }`)
    }

    styleLines.push(`@keyframes f${i} { ${keyframes.join("; ")} }`)
    styleLines.push(`.f${i} { animation: f${i} ${totalSeconds}s step-end ${iterationCount}; opacity: 0 }`)

    cumulativeTime += durations[i]!
  }

  // The first frame should start visible
  styleLines.push(`.f0 { opacity: 1 }`)

  // Build SVG groups for each frame
  const groups: string[] = []
  for (let i = 0; i < frames.length; i++) {
    const content = stripSvgWrapper(frames[i]!.svg)
    groups.push(`<g class="f${i}">${content}</g>`)
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    `<style>`,
    ...styleLines,
    `</style>`,
    ...groups,
    `</svg>`,
  ].join("\n")
}
