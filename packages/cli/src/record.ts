/**
 * Record command — captures a terminal session as a sequence of SVG frames.
 *
 * Great for docs, bug reports, and demos. Supports two output formats:
 * - `frames`: individual SVG files in an output directory
 * - `html`: a single self-contained HTML slideshow
 */

import { createSessionManager } from "./session.ts"
import { snapshotVisualState } from "../../../src/recording.ts"
import { generateSlideshow, type SlideshowFrame } from "../../../src/view/slideshow.ts"
import { mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

// ── Types ──

export interface RecordOptions {
  command: string[]
  cols: number
  rows: number
  interval: number
  duration: number | null
  outputDir: string
  format: "frames" | "html"
}

/**
 * A captured SVG frame. Alias of the `view/` module's `SlideshowFrame` — the
 * slideshow generator now lives there (Recording-domain unification Phase 3).
 */
export type RecordedFrame = SlideshowFrame

// ── Frame change detection ──

/**
 * Determines whether a new frame should be captured by comparing terminal text
 * with the previous frame's text. Returns true if content has changed.
 */
export function hasFrameChanged(currentText: string, previousText: string | null): boolean {
  if (previousText === null) return true
  return currentText !== previousText
}

// ── HTML slideshow generation ──

/**
 * Generates a self-contained HTML file with all SVG frames as an auto-playing
 * slideshow. Thin re-export of the `view/` module's `generateSlideshow` — the
 * slideshow is one `view` mode (Recording-domain unification Phase 3).
 */
export function generateHtmlSlideshow(frames: RecordedFrame[], intervalMs: number): string {
  return generateSlideshow(frames, intervalMs)
}

// ── Record command ──

export async function recordCommand(opts: RecordOptions): Promise<void> {
  const manager = createSessionManager()
  const frames: RecordedFrame[] = []
  let previousText: string | null = null
  let frameIndex = 0
  const startTime = Date.now()

  try {
    const { terminal } = await manager.createSession({
      command: opts.command,
      cols: opts.cols,
      rows: opts.rows,
      waitFor: "content",
      timeout: 5000,
    })

    console.error(`Recording: ${opts.command.join(" ")} (${opts.cols}x${opts.rows})`)
    console.error(`Interval: ${opts.interval}ms, Format: ${opts.format}`)
    if (opts.duration) console.error(`Duration: ${opts.duration}s`)
    console.error("Press Ctrl+C to stop recording.\n")

    // Set up the capture loop
    const captureFrame = (): boolean => {
      const currentText = snapshotVisualState(terminal)
      if (hasFrameChanged(currentText, previousText)) {
        const svg = terminal.screenshotSvg()
        const timestamp = Date.now() - startTime
        frames.push({ index: frameIndex, timestamp, svg })
        previousText = currentText
        frameIndex++
        return true
      }
      return false
    }

    // Capture initial frame
    captureFrame()

    // Periodic capture via polling
    await new Promise<void>((resolvePromise) => {
      const intervalId = setInterval(() => {
        // Check if process is still alive
        if (!terminal.alive) {
          clearInterval(intervalId)
          resolvePromise()
          return
        }

        // Check duration limit
        if (opts.duration && (Date.now() - startTime) / 1000 >= opts.duration) {
          clearInterval(intervalId)
          resolvePromise()
          return
        }

        captureFrame()
      }, opts.interval)

      // Handle Ctrl+C
      const onSignal = () => {
        clearInterval(intervalId)
        process.removeListener("SIGINT", onSignal)
        resolvePromise()
      }
      process.on("SIGINT", onSignal)
    })

    // Capture final frame in case content changed since last interval
    captureFrame()

    console.error(`\nRecorded ${frames.length} frames in ${((Date.now() - startTime) / 1000).toFixed(1)}s`)

    // Write output
    if (opts.format === "html") {
      const outputPath = opts.outputDir.endsWith(".html") ? opts.outputDir : join(opts.outputDir, "recording.html")
      const dir = outputPath.endsWith(".html") ? resolve(outputPath, "..") : opts.outputDir
      await mkdir(dir, { recursive: true })
      const html = generateHtmlSlideshow(frames, opts.interval)
      await writeFile(outputPath, html, "utf-8")
      console.error(`HTML slideshow saved: ${outputPath}`)
    } else {
      await mkdir(opts.outputDir, { recursive: true })
      for (const frame of frames) {
        const fileName = `frame-${String(frame.index).padStart(4, "0")}.svg`
        const filePath = join(opts.outputDir, fileName)
        await writeFile(filePath, frame.svg, "utf-8")
      }
      console.error(`${frames.length} SVG frames saved to: ${opts.outputDir}`)
    }
  } finally {
    await manager.stopAll()
  }
}
