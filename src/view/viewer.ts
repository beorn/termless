/**
 * HTML trace viewer for frame-trace output.
 *
 * Phase 5 of the Visual Eyes epic (@km/infra/15376).
 *
 * `writeViewer(dir)` reads a frame-trace directory (`index.jsonl` + `NNNNN.png`
 * files) and emits a self-contained `viewer.html` alongside them. The viewer is
 * a single file with all data inlined — jsonl rows as a JSON blob, PNGs as
 * base64 data URIs — so it works by double-clicking the file with no server
 * and no cross-origin `file://` fetch.
 *
 * `createFrameTracer`'s `stop()` calls `writeViewer` automatically, so every
 * trace gets a viewer. `writeViewer` is also exported for standalone use on an
 * existing trace directory.
 *
 * The browser-side JS lives inside the template string below — it is vanilla,
 * framework-free, build-step-free. It is its own world: the "no classes / no
 * globals" rule applies to the .ts side, not the inlined browser code.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { recordingToTraceFrames } from "../recording/frame-trace-recording.ts"
import type { TraceFrame } from "../recording/frame-trace.ts"
import type { Recording } from "../recording/recording.ts"

export interface WriteViewerResult {
  /** Absolute path to the generated viewer.html. */
  viewerFile: string
  /** Number of frames inlined. */
  frameCount: number
  /** Number of PNGs inlined as data URIs. */
  imageCount: number
  /** Byte length of the generated HTML. */
  bytes: number
}

/** Parse a frame-trace `index.jsonl`, tolerating a truncated final line. */
function parseIndex(indexPath: string): TraceFrame[] {
  const raw = readFileSync(indexPath, "utf-8")
  const frames: TraceFrame[] = []
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (trimmed === "") continue
    try {
      frames.push(JSON.parse(trimmed) as TraceFrame)
    } catch {
      // Truncated/partial final line from a crashed session — stop here.
      break
    }
  }
  return frames
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
}

/** base64-encode a binary file into a `data:` URI, runtime-agnostic. */
function fileToDataUri(path: string): string {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase()
  const mime = MIME_BY_EXT[ext] ?? "image/png"
  const bytes = readFileSync(path)
  const b64 = Buffer.from(bytes).toString("base64")
  return `data:${mime};base64,${b64}`
}

/**
 * Generate `viewer.html` for a frame-trace directory.
 *
 * @param dir Directory containing `index.jsonl` and `NNNNN.png` files.
 * @returns Metadata about the generated viewer.
 */
export function writeViewer(dir: string): WriteViewerResult {
  const indexPath = join(dir, "index.jsonl")
  if (!existsSync(indexPath)) {
    throw new Error(`writeViewer: no index.jsonl in ${dir}`)
  }
  const frames = parseIndex(indexPath)
  return emitViewer(frames, dir)
}

/**
 * Generate `viewer.html` from a unified {@link Recording}'s `frames`
 * projection (Phase 2 of the Recording-domain unification).
 *
 * This is the {@link Recording}-consuming entry point — `writeViewer` parses
 * the on-disk `index.jsonl`; this consumes the in-memory model directly. The
 * model → on-disk `TraceFrame` projection routes through the shared
 * {@link recordingToTraceFrames} codec (the same one `native-rec` and
 * `writeVisualTraceFromRecording` use), so there is exactly one such projection
 * in termless. PNGs are still inlined from `dir` (the projection's `png` field
 * is a path relative to the recording bundle).
 *
 * @throws {Error} when the recording has no `frames` projection.
 */
export function writeViewerFromRecording(recording: Recording, dir: string): WriteViewerResult {
  const modelFrames = recording.frames
  if (modelFrames === undefined || modelFrames.length === 0) {
    throw new Error("writeViewerFromRecording: recording has no frames projection")
  }
  return emitViewer(recordingToTraceFrames(recording), dir)
}

/**
 * Shared viewer-emission core: inline referenced PNGs, render the HTML
 * template, write `viewer.html`. Used by both `writeViewer` (on-disk source)
 * and `writeViewerFromRecording` (in-memory `Recording` source).
 */
function emitViewer(frames: TraceFrame[], dir: string): WriteViewerResult {
  // Inline every referenced PNG as a data URI. Frames may share a PNG name
  // (they don't here — dedupe points dups at duplicate_of), and duplicate
  // frames have png:null; we resolve those through duplicate_of at view time.
  const images: Record<string, string> = {}
  const pngOnDisk = existsSync(dir) ? new Set(readdirSync(dir).filter((f) => /\.png$/i.test(f))) : new Set<string>()
  for (const frame of frames) {
    if (frame.png && pngOnDisk.has(frame.png) && !(frame.png in images)) {
      images[frame.png] = fileToDataUri(join(dir, frame.png))
    }
  }

  const payload = JSON.stringify({ frames, images })
  const html = renderTemplate(payload, dir)
  const viewerFile = join(dir, "viewer.html")
  writeFileSync(viewerFile, html, "utf-8")

  return {
    viewerFile,
    frameCount: frames.length,
    imageCount: Object.keys(images).length,
    bytes: Buffer.byteLength(html, "utf-8"),
  }
}

/**
 * Build the self-contained HTML document.
 *
 * The data payload is embedded in a `<script type="application/json">` tag
 * (not a JS literal) so payload contents can never break out into executable
 * context. The only escaping needed is `</` → `<\/` so the JSON can't close
 * the script tag early.
 */
function renderTemplate(payload: string, dir: string): string {
  const safePayload = payload.replace(/<\//g, "<\\/")
  const title = `Frame Trace — ${dir.replace(/<\//g, "<\\/")}`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${VIEWER_CSS}
</style>
</head>
<body>
<header id="viewer-header">
  <h1>Frame Trace Viewer</h1>
  <div id="trace-meta"></div>
</header>
<div id="toolbar">
  <input id="find-input" type="search" placeholder="Find in ANSI input…" autocomplete="off">
  <input id="filter-input" type="search" placeholder="Filter rows (free-text predicate over JSON)…" autocomplete="off">
  <button id="diff-toggle" type="button">Diff mode: off</button>
  <span id="diff-hint"></span>
</div>
<div id="timeline-wrap">
  <div id="timeline" tabindex="0" role="listbox" aria-label="Frame timeline"></div>
</div>
<main id="detail">
  <section id="preview-pane">
    <div id="preview-stage">
      <img id="preview-img" alt="frame preview">
      <canvas id="diff-canvas"></canvas>
    </div>
  </section>
  <aside id="info-pane">
    <div id="frame-info"></div>
    <div id="ansi-block">
      <h3>ANSI input preview</h3>
      <pre id="ansi-preview"></pre>
    </div>
    <div id="silvery-block" hidden>
      <h3>Silvery state</h3>
      <pre id="silvery-state"></pre>
    </div>
  </aside>
</main>
<footer id="viewer-footer">
  <span>Arrow keys / <kbd>j</kbd> <kbd>k</kbd> to scrub · click a tick to select · diff mode: pick two frames</span>
</footer>
<script type="application/json" id="trace-data">${safePayload}</script>
<script>
${VIEWER_JS}
</script>
</body>
</html>
`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

const VIEWER_CSS = `
:root {
  --bg: #14161a; --panel: #1d2026; --panel2: #262a32; --line: #333842;
  --fg: #e6e8ec; --muted: #8b919e; --accent: #4ea1ff; --idle: #3a3f49;
  --diff: #ff3b4e; --ok: #3ddc84; --warn: #ffb454;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  background: var(--bg); color: var(--fg);
  font: 13px/1.5 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  display: flex; flex-direction: column; height: 100vh;
}
#viewer-header { padding: 8px 14px; border-bottom: 1px solid var(--line); }
#viewer-header h1 { font-size: 15px; margin: 0 0 2px; }
#trace-meta { color: var(--muted); font-size: 11px; }
#toolbar {
  display: flex; gap: 8px; padding: 8px 14px; align-items: center;
  border-bottom: 1px solid var(--line); flex-wrap: wrap;
}
#toolbar input[type=search] {
  background: var(--panel2); color: var(--fg); border: 1px solid var(--line);
  border-radius: 4px; padding: 5px 8px; font: inherit; min-width: 220px;
}
#toolbar input:focus { outline: 1px solid var(--accent); }
#diff-toggle {
  background: var(--panel2); color: var(--fg); border: 1px solid var(--line);
  border-radius: 4px; padding: 5px 10px; font: inherit; cursor: pointer;
}
#diff-toggle.on { background: var(--accent); color: #06121f; border-color: var(--accent); }
#diff-hint { color: var(--warn); font-size: 11px; }
#timeline-wrap { border-bottom: 1px solid var(--line); background: var(--panel); }
#timeline {
  display: flex; align-items: stretch; gap: 1px; height: 56px;
  overflow-x: auto; overflow-y: hidden; padding: 6px 8px; outline: none;
}
#timeline:focus { box-shadow: inset 0 0 0 1px var(--accent); }
.tick {
  flex: 0 0 6px; min-width: 6px; background: var(--accent);
  border-radius: 2px; cursor: pointer; position: relative; opacity: 0.85;
}
.tick.dup { background: var(--idle); opacity: 0.6; }
.tick.idle-gap { background: var(--idle); flex-basis: 14px; opacity: 0.35; }
.tick.hidden-row { display: none; }
.tick.match { box-shadow: inset 0 0 0 2px var(--warn); }
.tick.selected { box-shadow: inset 0 0 0 2px var(--fg); opacity: 1; }
.tick.diff-a { box-shadow: inset 0 0 0 2px var(--ok); opacity: 1; }
.tick.diff-b { box-shadow: inset 0 0 0 2px var(--diff); opacity: 1; }
.tick:hover { opacity: 1; }
#detail { flex: 1; display: flex; min-height: 0; }
#preview-pane {
  flex: 1; display: flex; align-items: center; justify-content: center;
  background: #0c0d10; padding: 14px; min-width: 0;
}
#preview-stage { position: relative; max-width: 100%; max-height: 100%; }
#preview-img { max-width: 100%; max-height: 70vh; display: block; image-rendering: pixelated; }
#diff-canvas {
  position: absolute; left: 0; top: 0; pointer-events: none; display: none;
  max-width: 100%; max-height: 70vh;
}
#info-pane {
  width: 360px; flex: 0 0 360px; border-left: 1px solid var(--line);
  padding: 12px 14px; overflow-y: auto; background: var(--panel);
}
#info-pane h3 { font-size: 11px; text-transform: uppercase; color: var(--muted); margin: 14px 0 4px; }
#frame-info { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; }
#frame-info .k { color: var(--muted); }
#frame-info .v { color: var(--fg); word-break: break-all; }
#frame-info .v.delta-pos { color: var(--warn); }
pre {
  background: var(--panel2); border: 1px solid var(--line); border-radius: 4px;
  padding: 8px; white-space: pre-wrap; word-break: break-all; margin: 0;
  max-height: 240px; overflow: auto; font-size: 12px;
}
#viewer-footer { padding: 6px 14px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11px; }
kbd {
  background: var(--panel2); border: 1px solid var(--line); border-radius: 3px;
  padding: 0 4px; font-size: 10px;
}
.empty { color: var(--muted); padding: 20px; text-align: center; }
`

const VIEWER_JS = `
"use strict";
(function () {
  // ── Data ──────────────────────────────────────────────────────────────
  var dataEl = document.getElementById("trace-data");
  var DATA = JSON.parse(dataEl.textContent || "{}");
  var FRAMES = DATA.frames || [];
  var IMAGES = DATA.images || {};

  var els = {
    timeline: document.getElementById("timeline"),
    meta: document.getElementById("trace-meta"),
    previewImg: document.getElementById("preview-img"),
    diffCanvas: document.getElementById("diff-canvas"),
    frameInfo: document.getElementById("frame-info"),
    ansiPreview: document.getElementById("ansi-preview"),
    silveryBlock: document.getElementById("silvery-block"),
    silveryState: document.getElementById("silvery-state"),
    findInput: document.getElementById("find-input"),
    filterInput: document.getElementById("filter-input"),
    diffToggle: document.getElementById("diff-toggle"),
    diffHint: document.getElementById("diff-hint"),
  };

  // ── State ─────────────────────────────────────────────────────────────
  var selected = FRAMES.length ? 0 : -1;
  var diffMode = false;
  var diffA = -1;
  var diffB = -1;
  var ticks = [];          // tick DOM elements, indexed by frame index
  var hiddenSet = new Set(); // frame indices filtered out

  // Resolve the PNG for a frame, following duplicate_of for deduped frames.
  function imageForFrame(idx) {
    var f = FRAMES[idx];
    if (!f) return null;
    if (f.png && IMAGES[f.png]) return IMAGES[f.png];
    if (f.duplicate_of != null) {
      // duplicate_of is a 1-based seq; find that frame.
      for (var i = 0; i < FRAMES.length; i++) {
        if (FRAMES[i].seq === f.duplicate_of && FRAMES[i].png && IMAGES[FRAMES[i].png]) {
          return IMAGES[FRAMES[i].png];
        }
      }
    }
    return null;
  }

  // Idle-gap detection: median inter-frame gap; anything >3x median is "idle".
  function computeIdleThreshold() {
    var gaps = [];
    for (var i = 1; i < FRAMES.length; i++) {
      var g = FRAMES[i].ts - FRAMES[i - 1].ts;
      if (g >= 0) gaps.push(g);
    }
    if (!gaps.length) return Infinity;
    gaps.sort(function (a, b) { return a - b; });
    var median = gaps[Math.floor(gaps.length / 2)] || 0;
    return Math.max(median * 3, 200);
  }
  var idleThreshold = computeIdleThreshold();

  // ── Build timeline ────────────────────────────────────────────────────
  function buildTimeline() {
    els.timeline.innerHTML = "";
    ticks = [];
    if (!FRAMES.length) {
      els.timeline.innerHTML = '<div class="empty">No frames in this trace.</div>';
      return;
    }
    for (var i = 0; i < FRAMES.length; i++) {
      var f = FRAMES[i];
      // Idle gap marker before this frame.
      if (i > 0) {
        var gap = f.ts - FRAMES[i - 1].ts;
        if (gap > idleThreshold) {
          var g = document.createElement("div");
          g.className = "tick idle-gap";
          g.title = "idle " + gap + "ms";
          els.timeline.appendChild(g);
        }
      }
      var t = document.createElement("div");
      t.className = "tick" + (f.duplicate_of != null ? " dup" : "");
      t.dataset.idx = String(i);
      t.setAttribute("role", "option");
      t.title = "frame " + f.seq + " · " + (f.duration_since_prev_ms || 0) + "ms · " +
        (f.bytes_in_since_last || 0) + "B";
      (function (idx) {
        t.addEventListener("click", function () { onTickClick(idx); });
      })(i);
      els.timeline.appendChild(t);
      ticks[i] = t;
    }
  }

  function onTickClick(idx) {
    if (diffMode) {
      if (diffA === -1 || (diffA !== -1 && diffB !== -1)) {
        diffA = idx; diffB = -1;
      } else {
        diffB = idx;
      }
      selected = idx;
      render();
      if (diffA !== -1 && diffB !== -1) renderDiff();
    } else {
      selected = idx;
      render();
    }
  }

  // ── Detail render ─────────────────────────────────────────────────────
  function render() {
    // Tick classes.
    for (var i = 0; i < ticks.length; i++) {
      var t = ticks[i];
      if (!t) continue;
      t.classList.toggle("selected", i === selected && !diffMode);
      t.classList.toggle("diff-a", i === diffA);
      t.classList.toggle("diff-b", i === diffB);
      t.classList.toggle("hidden-row", hiddenSet.has(i));
    }
    var f = FRAMES[selected];
    if (!f) return;

    // Preview image.
    var uri = imageForFrame(selected);
    if (uri) {
      els.previewImg.src = uri;
      els.previewImg.style.display = "block";
    } else {
      els.previewImg.removeAttribute("src");
      els.previewImg.style.display = "none";
    }
    if (!diffMode || diffA === -1 || diffB === -1) {
      els.diffCanvas.style.display = "none";
    }

    // Bytes-in delta vs previous frame.
    var prevBytes = selected > 0 ? (FRAMES[selected - 1].bytes_in_since_last || 0) : 0;
    var delta = (f.bytes_in_since_last || 0) - prevBytes;

    // Frame info grid.
    var rows = [
      ["seq", f.seq],
      ["timestamp", f.iso || String(f.ts)],
      ["hash", f.hash],
      ["duplicate of", f.duplicate_of == null ? "—" : f.duplicate_of],
      ["bytes in", f.bytes_in_since_last || 0],
      ["bytes Δ", (delta >= 0 ? "+" : "") + delta],
      ["since prev", (f.duration_since_prev_ms || 0) + "ms"],
      ["render", (f.render_ms || 0) + "ms"],
      ["buffer", f.buffer ? (f.buffer.cols + "×" + f.buffer.rows) : "—"],
      ["cursor", f.buffer && f.buffer.cursor
        ? ("r" + f.buffer.cursor.row + " c" + f.buffer.cursor.col) : "—"],
      ["png", f.png || "(deduped)"],
    ];
    var html = "";
    for (var r = 0; r < rows.length; r++) {
      var deltaCls = rows[r][0] === "bytes Δ" && delta > 0 ? " delta-pos" : "";
      html += '<div class="k">' + esc(rows[r][0]) + '</div>' +
        '<div class="v' + deltaCls + '">' + esc(String(rows[r][1])) + '</div>';
    }
    els.frameInfo.innerHTML = html;

    // ANSI input preview.
    els.ansiPreview.textContent = f.ansi_input_preview && f.ansi_input_preview.length
      ? f.ansi_input_preview : "(no input recorded for this frame)";

    // Silvery state — render only when present.
    if (f.silvery !== undefined && f.silvery !== null) {
      els.silveryBlock.hidden = false;
      els.silveryState.textContent = typeof f.silvery === "string"
        ? f.silvery : JSON.stringify(f.silvery, null, 2);
    } else {
      els.silveryBlock.hidden = true;
    }
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ── Find: highlight ticks whose ansi preview matches ──────────────────
  function applyFind() {
    var q = els.findInput.value.toLowerCase();
    for (var i = 0; i < FRAMES.length; i++) {
      if (!ticks[i]) continue;
      var hit = q !== "" &&
        String(FRAMES[i].ansi_input_preview || "").toLowerCase().indexOf(q) !== -1;
      ticks[i].classList.toggle("match", hit);
    }
  }

  // ── Filter: free-text predicate over row JSON ─────────────────────────
  // A frame is shown when the predicate substring appears in its JSON, OR
  // when the predicate is a "key:value" / "key=value" form that matches.
  function applyFilter() {
    var q = els.filterInput.value.trim().toLowerCase();
    hiddenSet.clear();
    if (q !== "") {
      for (var i = 0; i < FRAMES.length; i++) {
        var json = JSON.stringify(FRAMES[i]).toLowerCase();
        if (json.indexOf(q) === -1) hiddenSet.add(i);
      }
      // Keep selection valid.
      if (hiddenSet.has(selected)) {
        var next = FRAMES.findIndex(function (_, i) { return !hiddenSet.has(i); });
        if (next !== -1) selected = next;
      }
    }
    render();
    updateMeta();
  }

  // ── Diff: pixel-diff two frames onto the overlay canvas ───────────────
  function renderDiff() {
    var uriA = imageForFrame(diffA);
    var uriB = imageForFrame(diffB);
    if (!uriA || !uriB) {
      els.diffHint.textContent = "diff needs two frames with images";
      return;
    }
    var imgA = new Image();
    var imgB = new Image();
    var loaded = 0;
    function ready() {
      loaded++;
      if (loaded < 2) return;
      var w = Math.max(imgA.naturalWidth, imgB.naturalWidth);
      var h = Math.max(imgA.naturalHeight, imgB.naturalHeight);
      if (!w || !h) return;
      var ca = document.createElement("canvas"); ca.width = w; ca.height = h;
      var cb = document.createElement("canvas"); cb.width = w; cb.height = h;
      ca.getContext("2d").drawImage(imgA, 0, 0);
      cb.getContext("2d").drawImage(imgB, 0, 0);
      var da = ca.getContext("2d").getImageData(0, 0, w, h);
      var db = cb.getContext("2d").getImageData(0, 0, w, h);
      var out = els.diffCanvas;
      out.width = w; out.height = h;
      var octx = out.getContext("2d");
      var overlay = octx.createImageData(w, h);
      var changed = 0;
      for (var p = 0; p < da.data.length; p += 4) {
        var dr = Math.abs(da.data[p] - db.data[p]);
        var dg = Math.abs(da.data[p + 1] - db.data[p + 1]);
        var dbl = Math.abs(da.data[p + 2] - db.data[p + 2]);
        if (dr + dg + dbl > 24) {
          overlay.data[p] = 255; overlay.data[p + 1] = 59;
          overlay.data[p + 2] = 78; overlay.data[p + 3] = 170;
          changed++;
        }
      }
      octx.putImageData(overlay, 0, 0);
      // Show frame B as the base, overlay on top.
      els.previewImg.src = uriB;
      els.diffCanvas.style.display = "block";
      els.diffHint.textContent = "diff " + FRAMES[diffA].seq + " → " + FRAMES[diffB].seq +
        " · " + changed + " px changed";
    }
    imgA.onload = ready; imgB.onload = ready;
    imgA.src = uriA; imgB.src = uriB;
  }

  function toggleDiff() {
    diffMode = !diffMode;
    els.diffToggle.classList.toggle("on", diffMode);
    els.diffToggle.textContent = "Diff mode: " + (diffMode ? "on" : "off");
    if (!diffMode) {
      diffA = -1; diffB = -1;
      els.diffCanvas.style.display = "none";
      els.diffHint.textContent = "";
    } else {
      els.diffHint.textContent = "click two frames to diff";
    }
    render();
  }

  // ── Keyboard scrub ────────────────────────────────────────────────────
  function step(dir) {
    if (!FRAMES.length) return;
    var i = selected;
    for (var n = 0; n < FRAMES.length; n++) {
      i += dir;
      if (i < 0 || i >= FRAMES.length) return;
      if (!hiddenSet.has(i)) { selected = i; render(); return; }
    }
  }

  document.addEventListener("keydown", function (e) {
    var tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") {
      if (e.key === "Escape") e.target.blur();
      return;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault(); step(1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault(); step(-1);
    } else if (e.key === "Home") {
      e.preventDefault(); selected = 0; render();
    } else if (e.key === "End") {
      e.preventDefault(); selected = FRAMES.length - 1; render();
    } else if (e.key === "d") {
      toggleDiff();
    }
  });

  // ── Meta line ─────────────────────────────────────────────────────────
  function updateMeta() {
    var visible = FRAMES.length - hiddenSet.size;
    var dur = FRAMES.length > 1
      ? (FRAMES[FRAMES.length - 1].ts - FRAMES[0].ts) : 0;
    var uniq = 0;
    for (var i = 0; i < FRAMES.length; i++) if (FRAMES[i].duplicate_of == null) uniq++;
    els.meta.textContent = FRAMES.length + " frames (" + uniq + " unique) · " +
      visible + " shown · " + dur + "ms span · " +
      Object.keys(IMAGES).length + " images inlined";
  }

  // ── Wire up ───────────────────────────────────────────────────────────
  els.findInput.addEventListener("input", applyFind);
  els.filterInput.addEventListener("input", applyFilter);
  els.diffToggle.addEventListener("click", toggleDiff);

  buildTimeline();
  updateMeta();
  render();
})();
`
