/**
 * Record command — captures a terminal session as a sequence of SVG frames.
 *
 * Great for docs, bug reports, and demos. Supports two output formats:
 * - `frames`: individual SVG files in an output directory
 * - `html`: a single self-contained HTML slideshow
 */

import { createSessionManager } from "./session.ts"
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

export interface RecordedFrame {
  index: number
  timestamp: number
  svg: string
}

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
 * Generates a self-contained HTML file with all SVG frames as an auto-playing slideshow.
 * Includes play/pause, frame navigation, frame counter, and timestamp display.
 */
export function generateHtmlSlideshow(frames: RecordedFrame[], intervalMs: number): string {
  if (frames.length === 0) {
    return `<!DOCTYPE html>
<html><head><title>termless recording</title></head>
<body><p>No frames recorded.</p></body></html>`
  }

  const escapedFrames = frames.map((f) => ({
    index: f.index,
    timestamp: f.timestamp,
    svg: f.svg,
  }))

  // Build inline SVG divs — one per frame, hidden by default except the first
  const frameDivs = escapedFrames
    .map(
      (f, i) =>
        `<div class="frame" id="frame-${i}" style="display:${i === 0 ? "block" : "none"}">${f.svg}</div>`,
    )
    .join("\n")

  const timestamps = JSON.stringify(escapedFrames.map((f) => f.timestamp))

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>termless recording</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #1e1e1e; color: #d4d4d4; font-family: system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; padding: 20px; }
  .player { position: relative; }
  .frame svg { display: block; }
  .controls { display: flex; align-items: center; gap: 12px; margin-top: 12px; padding: 8px 16px; background: #2d2d2d; border-radius: 6px; }
  .controls button { background: #3d3d3d; color: #d4d4d4; border: 1px solid #555; border-radius: 4px; padding: 4px 12px; cursor: pointer; font-size: 14px; }
  .controls button:hover { background: #4d4d4d; }
  .info { font-size: 13px; color: #888; }
  kbd { background: #3d3d3d; border: 1px solid #555; border-radius: 3px; padding: 1px 5px; font-size: 12px; }
</style>
</head>
<body>
<div class="player">
${frameDivs}
</div>
<div class="controls">
  <button id="prev-btn" title="Previous frame">&larr;</button>
  <button id="play-btn" title="Play/Pause">Pause</button>
  <button id="next-btn" title="Next frame">&rarr;</button>
  <span class="info" id="frame-info">Frame 1 / ${frames.length}</span>
  <span class="info" id="time-info">0ms</span>
  <span class="info"><kbd>&larr;</kbd> <kbd>&rarr;</kbd> <kbd>Space</kbd></span>
</div>
<script>
(function() {
  const totalFrames = ${frames.length};
  const timestamps = ${timestamps};
  const interval = ${intervalMs};
  let current = 0;
  let playing = true;
  let timer = null;

  const playBtn = document.getElementById("play-btn");
  const prevBtn = document.getElementById("prev-btn");
  const nextBtn = document.getElementById("next-btn");
  const frameInfo = document.getElementById("frame-info");
  const timeInfo = document.getElementById("time-info");

  function showFrame(idx) {
    document.getElementById("frame-" + current).style.display = "none";
    current = idx;
    document.getElementById("frame-" + current).style.display = "block";
    frameInfo.textContent = "Frame " + (current + 1) + " / " + totalFrames;
    timeInfo.textContent = timestamps[current] + "ms";
  }

  function nextFrame() {
    showFrame((current + 1) % totalFrames);
  }

  function prevFrame() {
    showFrame((current - 1 + totalFrames) % totalFrames);
  }

  function startPlayback() {
    if (timer) return;
    playing = true;
    playBtn.textContent = "Pause";
    timer = setInterval(nextFrame, interval);
  }

  function stopPlayback() {
    playing = false;
    playBtn.textContent = "Play";
    if (timer) { clearInterval(timer); timer = null; }
  }

  function togglePlayback() {
    if (playing) stopPlayback(); else startPlayback();
  }

  playBtn.addEventListener("click", togglePlayback);
  prevBtn.addEventListener("click", function() { stopPlayback(); prevFrame(); });
  nextBtn.addEventListener("click", function() { stopPlayback(); nextFrame(); });

  document.addEventListener("keydown", function(e) {
    if (e.key === "ArrowLeft") { stopPlayback(); prevFrame(); }
    else if (e.key === "ArrowRight") { stopPlayback(); nextFrame(); }
    else if (e.key === " ") { e.preventDefault(); togglePlayback(); }
  });

  startPlayback();
})();
</script>
</body>
</html>`
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
      const currentText = terminal.getText()
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
