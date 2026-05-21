/**
 * SVG slideshow viewer — the simple `view` mode.
 *
 * Phase 3 of the Recording-domain unification (design doc §5). The recording
 * domain has **one viewer** — the scrubbable {@link "./viewer.ts"} (timeline
 * scrub, find, filter, pixel-diff, frame metadata) is canonical. This
 * slideshow is a distinct *mode* of the same `view` verb, not a second viewer
 * concept: an auto-playing SVG carousel for live captures that have no
 * frame-trace PNG directory to scrub.
 *
 * It consumes an in-memory list of SVG frames (`SlideshowFrame[]`) — produced
 * by `record` capturing `screenshotSvg()` per interval — and emits one
 * self-contained HTML file. No PNGs, no `index.jsonl`, no bundle directory.
 *
 * Browser-side JS lives in the template string below; it is vanilla and
 * build-step-free — the "no classes / no globals" rule applies to the .ts
 * side, not the inlined browser code.
 */

/** One captured SVG still on the slideshow timeline. */
export interface SlideshowFrame {
  /** Zero-based frame index. */
  index: number
  /** Milliseconds since capture start. */
  timestamp: number
  /** The frame's SVG markup. */
  svg: string
}

/**
 * Generate a self-contained HTML slideshow from a list of SVG frames.
 *
 * Includes play/pause, prev/next, a frame counter, and a timestamp display.
 * The output is a single file with every frame's SVG inlined — works by
 * double-clicking with no server.
 */
export function generateSlideshow(frames: SlideshowFrame[], intervalMs: number): string {
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
    .map((f, i) => `<div class="frame" id="frame-${i}" style="display:${i === 0 ? "block" : "none"}">${f.svg}</div>`)
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
