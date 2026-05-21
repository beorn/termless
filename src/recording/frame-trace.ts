/**
 * Frame-trace mode for termless.
 *
 * Captures every render-relevant buffer mutation with timestamp + content
 * hash + (optional) PNG. Designed to make visual bugs investigable:
 * "the border disappeared after frame 47" instead of "looks wrong somewhere".
 *
 * Phase 2 of the Visual Eyes epic (@km/infra/mcp-tty-ghostty-backend-toggle).
 *
 * Usage (consumer-side, e.g., mcp__tty plugin):
 *   const tracer = createFrameTracer(terminal, { dir: "/tmp/trace-1/" })
 *   // ... terminal runs ...
 *   const summary = await tracer.stop()
 *   // tracer.framesSinceSeq(0) returns the full trace
 *
 * Output layout:
 *   /tmp/trace-1/
 *     index.jsonl    — append-only, one TraceFrame per line; tolerant to truncation
 *     00001.png      — unique frames only; duplicates point to original via duplicate_of
 *     00002.png
 *     ...
 *     viewer.html    — self-contained HTML trace viewer, written on stop()
 *
 * The tracer hooks into `terminal.onAfterWrite` (wired via TerminalCreateOptions)
 * and debounces frame captures by `debounceMs` so we get one frame per render
 * pass rather than one per cell-write.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { writeViewer } from "../view/viewer.ts"
import { traceToRecording } from "./frame-trace-recording.ts"
import { writeRecording } from "./native/native-trec.ts"
import type { Recording } from "./recording.ts"
import type { ScreenshotOptions, Terminal } from "../terminal/types.ts"

export interface FrameTraceOptions {
  /** Output directory. Created if missing. */
  dir: string
  /** Debounce interval. Default: 16ms (one render frame at 60fps). */
  debounceMs?: number
  /** Hard cap on frames captured. Default: 10_000. */
  maxFrames?: number
  /** Skip writing PNGs for duplicate hashes (still records in index). Default: true. */
  dedupe?: boolean
  /** Override canvas-render options forwarded to @termless/ghostty's renderTerminalPng. */
  canvas?: Pick<ScreenshotOptions, "cols" | "rows" | "fontSize" | "fontPath" | "theme" | "dpr">
  /**
   * If provided, called instead of `@termless/ghostty.renderTerminalPng` to
   * produce the frame PNG bytes. Useful for tests that don't want to spin up
   * the native canvas renderer / WASM.
   */
  renderFn?: (terminal: Terminal) => Promise<Uint8Array>
  /**
   * Path to a render-event sidecar JSONL written by silvery's render-trace
   * (`SILVERY_TRACE_FRAMES` — Phase 4 of the Visual Eyes epic). When set,
   * each captured frame is annotated with the silvery render event whose
   * timestamp is the closest match (the `silvery` field on `TraceFrame`).
   *
   * Default: `<dir>/render-events.jsonl` — the path silvery writes to when
   * `SILVERY_TRACE_FRAMES` points at this same trace directory. Pass an
   * explicit path to read events from elsewhere; pass `null` to disable the
   * join entirely.
   */
  silveryEventsFile?: string | null
}

/**
 * A silvery render-boundary event, as written by silvery's `render-trace`
 * sidecar (`SILVERY_TRACE_FRAMES`). Mirrors silvery's `RenderDispatchedEvent`
 * shape — kept structural (not an import) so `@termless/core` stays
 * dependency-free of silvery.
 */
export interface SilveryRenderEvent {
  type: "RENDER_DISPATCHED"
  /** Wall-clock ms epoch — the join key. */
  ts: number
  renderCount: number
  reason: string
  dirtyRegions: { row: number; height: number }[]
  signalDelta: {
    nodesVisited: number
    nodesRendered: number
    nodesSkipped: number
    incremental: boolean
  }
  fiberHash: string
}

export interface TraceFrame {
  seq: number
  ts: number
  iso: string
  hash: string
  duplicate_of: number | null
  bytes_in_since_last: number
  ansi_input_preview: string
  buffer: {
    cols: number
    rows: number
    cursor: { row: number; col: number }
  }
  duration_since_prev_ms: number
  render_ms: number
  png: string | null
  /**
   * Optional silvery render-state snapshot. Populated by Phase 4 of the
   * Visual Eyes epic — the silvery `RENDER_DISPATCHED` event whose timestamp
   * is the closest match for this frame. Absent on traces recorded without a
   * silvery render-event sidecar. The viewer renders it when present and
   * omits the section when absent.
   *
   * Typed `SilveryRenderEvent | unknown` so older traces (or non-silvery
   * sources) that wrote an arbitrary value still type-check; new traces
   * populate it with a `SilveryRenderEvent`.
   */
  silvery?: SilveryRenderEvent | unknown
}

export interface FrameTraceSummary {
  count: number
  uniqueCount: number
  duplicateRatio: number
  totalBytes: number
  indexFile: string
  firstTs: number | null
  lastTs: number | null
  truncated: boolean
}

export interface FrameTracer {
  /** Hook to register with Terminal's `onAfterWrite`. */
  readonly onWrite: (data: Uint8Array) => void
  /** All frames recorded so far. */
  framesSinceSeq(seq: number): TraceFrame[]
  /** Frames recorded at or after `ts` (ms epoch). */
  framesSinceTime(ts: number): TraceFrame[]
  /** Flush pending debounced frame, close index file, return summary. */
  stop(): Promise<FrameTraceSummary>
  /**
   * Project the frames captured so far into the unified in-memory
   * {@link Recording} model — a `Recording` whose `frames` projection is
   * populated (Phase 2 of the Recording-domain unification).
   *
   * This is a pure in-memory projection: it touches no disk and does not
   * alter the `index.jsonl` + `NNNNN.png` layout. Call after `stop()` for the
   * complete trace, or any time for a snapshot.
   *
   * @throws {Error} when no frames have been captured.
   */
  toRecording(): Recording
  /**
   * Write the captured trace to a native `.trec` directory bundle at `trecDir`
   * (Phase 5 of the Recording-domain unification).
   *
   * `.trec` is the canonical full-fidelity on-disk recording format — a
   * directory whose `frames/` sub-tree is byte-compatible with the frame-trace
   * layout this tracer writes, wrapped with a `manifest.json`. The frame
   * tracer's own `index.jsonl` + `NNNNN.png` output (at the `dir` it was
   * created with) is left **untouched** — `writeTrec` is an additive native-
   * format export, not a replacement for the live trace directory.
   *
   * Call after `stop()`. The unique-frame PNGs are copied from the tracer's
   * live trace `dir` into the `.trec` `frames/` sub-tree.
   *
   * @param trecDir Destination `.trec` directory.
   * @throws {Error} when no frames have been captured.
   */
  writeTrec(trecDir: string): void
  /** Was the trace truncated by maxFrames cap. */
  readonly truncated: boolean
  /** Total frames recorded (unique + duplicate). */
  readonly count: number
}

// ── Hash helper: prefers Bun.hash.xxHash64 for speed; falls back to a
//    simple FNV-1a (deterministic, dep-free) otherwise. xxHash3 collision rate
//    is fine for "is this the same buffer state" over the typical 10k-frame
//    trace lifetime.

function hashBytes(bytes: Uint8Array | string): string {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes
  const bunHash = (globalThis as { Bun?: { hash?: { xxHash64?: (b: Uint8Array) => bigint } } }).Bun?.hash?.xxHash64
  if (bunHash) {
    return `xxh64:${bunHash(data).toString(16)}`
  }
  // FNV-1a 64-bit fallback.
  let h = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = (1n << 64n) - 1n
  for (let i = 0; i < data.length; i++) {
    h ^= BigInt(data[i] ?? 0)
    h = (h * prime) & mask
  }
  return `fnv1a:${h.toString(16)}`
}

function bufferFingerprint(terminal: Terminal): {
  hash: string
  cols: number
  rows: number
  cursorRow: number
  cursorCol: number
} {
  const lines = terminal.getLines()
  // Hash visible text per row + cursor position. Lightweight enough to call
  // on every debounced tick; differentiates render passes that change attrs
  // too (cellsToAnsi-like serialization could be heavier but more precise).
  const lineStrs: string[] = []
  for (const row of lines) {
    let s = ""
    for (const cell of row) {
      // Mix in char + a 1-byte attribute digest so attribute-only changes still
      // produce a new hash.
      const attrs =
        (cell.bold ? 1 : 0) |
        (cell.dim ? 2 : 0) |
        (cell.italic ? 4 : 0) |
        (cell.underline ? 8 : 0) |
        (cell.inverse ? 16 : 0) |
        (cell.strikethrough ? 32 : 0)
      const fg = cell.fg ? `${cell.fg.r},${cell.fg.g},${cell.fg.b}` : ""
      const bg = cell.bg ? `${cell.bg.r},${cell.bg.g},${cell.bg.b}` : ""
      s += `${cell.char}|${attrs}|${fg}|${bg};`
    }
    lineStrs.push(s)
  }
  const cursor = (() => {
    try {
      return terminal.getCursor()
    } catch {
      return { x: 0, y: 0, visible: true, style: "block" as const }
    }
  })()
  return {
    hash: hashBytes(lineStrs.join("\n")),
    cols: lines[0]?.length ?? 0,
    rows: lines.length,
    cursorRow: cursor.y,
    cursorCol: cursor.x,
  }
}

function previewAnsi(bytes: Uint8Array, maxLen = 80): string {
  const text = new TextDecoder().decode(bytes)
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + "…"
}

function padSeq(n: number, width = 5): string {
  return n.toString().padStart(width, "0")
}

// ── Silvery render-event join ────────────────────────────────────────────────
//
// silvery writes a `render-events.jsonl` sidecar (one RENDER_DISPATCHED event
// per line) when `SILVERY_TRACE_FRAMES` is set. The frame tracer reads that
// sidecar incrementally — re-reading the whole file each capture is fine; it's
// small, append-only, and a capture happens at most every `debounceMs`.

/**
 * A reader that incrementally tails a silvery render-event sidecar and
 * answers "which render event best matches a frame captured at ts T?".
 */
interface SilveryEventJoin {
  /** Re-read the sidecar if it grew; return the event closest to `ts`. */
  matchFor(ts: number): SilveryRenderEvent | null
}

/** Parse one JSONL line into a SilveryRenderEvent, or null if malformed. */
function parseSilveryEvent(line: string): SilveryRenderEvent | null {
  const trimmed = line.trim()
  if (trimmed.length === 0) return null
  try {
    const obj = JSON.parse(trimmed) as Partial<SilveryRenderEvent>
    if (obj.type !== "RENDER_DISPATCHED" || typeof obj.ts !== "number") return null
    return obj as SilveryRenderEvent
  } catch {
    return null
  }
}

/**
 * Create a join over the silvery render-event sidecar at `file`.
 *
 * The join is tolerant: a missing file, a truncated final line, or malformed
 * rows are skipped — frame capture is never blocked by sidecar issues. The
 * file is re-stat'd each `matchFor` call and only re-parsed when it grew.
 *
 * Matching rule: pick the event with the **largest `ts` ≤ frame `ts`** — the
 * render that produced this frame happened at or before the frame's capture.
 * If no event precedes the frame (clock skew, first frame), fall back to the
 * single closest event by absolute `ts` distance within a small window so
 * an early frame still gets annotated.
 */
function createSilveryEventJoin(file: string): SilveryEventJoin {
  const events: SilveryRenderEvent[] = []
  let lastSize = -1
  // Window for the "no event precedes the frame" fallback — a frame should
  // only borrow a later event if it's within one render-debounce or so.
  const FALLBACK_WINDOW_MS = 64

  function refresh(): void {
    let size: number
    try {
      size = statSync(file).size
    } catch {
      return // sidecar not created yet — silvery may not have rendered.
    }
    if (size === lastSize) return
    lastSize = size
    let text: string
    try {
      text = readFileSync(file, "utf-8")
    } catch {
      return
    }
    events.length = 0
    for (const line of text.split("\n")) {
      const ev = parseSilveryEvent(line)
      if (ev) events.push(ev)
    }
    // Sidecar is append-only in render order, but sort defensively so the
    // closest-match scan below can rely on ascending ts.
    events.sort((a, b) => a.ts - b.ts)
  }

  return {
    matchFor(ts: number): SilveryRenderEvent | null {
      refresh()
      if (events.length === 0) return null
      // Largest ts <= frame ts.
      let best: SilveryRenderEvent | null = null
      for (const ev of events) {
        if (ev.ts <= ts) best = ev
        else break
      }
      if (best) return best
      // No event precedes the frame — borrow the earliest event if it's
      // close enough (handles the first frame / coarse-clock skew).
      const earliest = events[0]!
      return earliest.ts - ts <= FALLBACK_WINDOW_MS ? earliest : null
    },
  }
}

export function createFrameTracer(terminal: Terminal, options: FrameTraceOptions): FrameTracer {
  const debounceMs = options.debounceMs ?? 16
  const maxFrames = options.maxFrames ?? 10_000
  const dedupe = options.dedupe ?? true
  const dir = options.dir
  // Default renderer: route through @termless/ghostty's renderTerminalPng.
  // Dynamic import keeps @termless/core install-independent of @termless/ghostty;
  // a missing module surfaces from the import itself, not from a top-level
  // dependency. Tests inject `renderFn` to avoid the WASM cost entirely.
  const renderFn =
    options.renderFn ??
    (async (t: Terminal): Promise<Uint8Array> => {
      const { renderTerminalPng } = (await import("@termless/ghostty")) as {
        renderTerminalPng: (term: Terminal, opts?: unknown) => Promise<Uint8Array>
      }
      return renderTerminalPng(t, options.canvas)
    })

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const indexFile = join(dir, "index.jsonl")
  // Truncate any prior index for this dir.
  appendFileSync(indexFile, "", { flag: "w" })

  // Silvery render-event join. `silveryEventsFile` defaults to the sidecar
  // silvery writes when `SILVERY_TRACE_FRAMES` points at this same dir;
  // pass `null` to disable.
  const silveryEventsFile =
    options.silveryEventsFile === null ? null : (options.silveryEventsFile ?? join(dir, "render-events.jsonl"))
  const silveryJoin = silveryEventsFile ? createSilveryEventJoin(silveryEventsFile) : null

  const frames: TraceFrame[] = []
  const hashToSeq = new Map<string, number>()
  let pendingTimer: ReturnType<typeof setTimeout> | null = null
  let bytesSinceLast = 0
  let lastAnsiPreview = ""
  let lastTs: number | null = null
  let firstTs: number | null = null
  let truncated = false
  let stopped = false

  function flushPending(): void {
    if (pendingTimer) {
      clearTimeout(pendingTimer)
      pendingTimer = null
    }
  }

  async function captureFrame(): Promise<void> {
    if (stopped) return
    if (frames.length >= maxFrames) {
      truncated = true
      return
    }
    const ts = Date.now()
    const renderStart = performance.now()
    const fp = bufferFingerprint(terminal)
    const seq = frames.length + 1
    const existing = hashToSeq.get(fp.hash)
    const duplicate_of = existing ?? null
    let pngRelPath: string | null = null
    let renderMs = 0
    if (existing == null) {
      // Unique frame — write the PNG.
      try {
        const png = await renderFn(terminal)
        const fname = `${padSeq(seq)}.png`
        await writeFile(join(dir, fname), png)
        pngRelPath = fname
        renderMs = +(performance.now() - renderStart).toFixed(2)
        hashToSeq.set(fp.hash, seq)
      } catch (err) {
        // Don't kill the trace — record the frame without PNG and continue.
        renderMs = +(performance.now() - renderStart).toFixed(2)
        // eslint-disable-next-line no-console
        console.error("[frame-trace] render failed:", (err as Error).message)
      }
    } else if (!dedupe) {
      // Forced re-render even though hash matches.
      const png = await renderFn(terminal)
      const fname = `${padSeq(seq)}.png`
      await writeFile(join(dir, fname), png)
      pngRelPath = fname
      renderMs = +(performance.now() - renderStart).toFixed(2)
    }
    const durSincePrev = lastTs == null ? 0 : ts - lastTs
    const frame: TraceFrame = {
      seq,
      ts,
      iso: new Date(ts).toISOString(),
      hash: fp.hash,
      duplicate_of,
      bytes_in_since_last: bytesSinceLast,
      ansi_input_preview: lastAnsiPreview,
      buffer: {
        cols: fp.cols,
        rows: fp.rows,
        cursor: { row: fp.cursorRow, col: fp.cursorCol },
      },
      duration_since_prev_ms: durSincePrev,
      render_ms: renderMs,
      png: pngRelPath,
    }
    // Join the closest silvery render event onto the frame. Absent when no
    // sidecar exists or no event matches — the `silvery` field stays
    // undefined and the viewer omits the section.
    const silveryEvent = silveryJoin?.matchFor(ts)
    if (silveryEvent) frame.silvery = silveryEvent
    frames.push(frame)
    appendFileSync(indexFile, JSON.stringify(frame) + "\n")
    if (firstTs == null) firstTs = ts
    lastTs = ts
    bytesSinceLast = 0
    lastAnsiPreview = ""
  }

  function scheduleCapture(): void {
    if (stopped || truncated) return
    if (pendingTimer) clearTimeout(pendingTimer)
    pendingTimer = setTimeout(() => {
      pendingTimer = null
      void captureFrame()
    }, debounceMs)
  }

  function onWrite(data: Uint8Array): void {
    bytesSinceLast += data.byteLength
    if (lastAnsiPreview === "") lastAnsiPreview = previewAnsi(data)
    scheduleCapture()
  }

  async function stop(): Promise<FrameTraceSummary> {
    if (pendingTimer) {
      clearTimeout(pendingTimer)
      pendingTimer = null
      // Flush one final frame if writes were pending.
      await captureFrame()
    }
    stopped = true
    const uniqueCount = hashToSeq.size
    const count = frames.length
    const totalBytes = frames.reduce((acc, f) => acc + f.bytes_in_since_last, 0)
    // Emit a self-contained HTML viewer alongside the trace so every trace is
    // immediately inspectable by double-clicking viewer.html — no server.
    // Never let a viewer-generation failure kill the trace summary.
    try {
      writeViewer(dir)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[frame-trace] viewer generation failed:", (err as Error).message)
    }
    return {
      count,
      uniqueCount,
      duplicateRatio: count === 0 ? 0 : 1 - uniqueCount / count,
      totalBytes,
      indexFile,
      firstTs,
      lastTs,
      truncated,
    }
  }

  return {
    onWrite,
    framesSinceSeq(seq: number) {
      return frames.filter((f) => f.seq > seq)
    },
    framesSinceTime(ts: number) {
      return frames.filter((f) => f.ts >= ts)
    },
    stop,
    toRecording(): Recording {
      // Pure in-memory projection — re-shapes the captured `frames` into the
      // unified Recording model. The on-disk `index.jsonl` + PNG layout is
      // untouched. Buffer geometry comes from the first frame (or the
      // tracer's canvas opts as a fallback for a 0-frame edge).
      const cols = frames[0]?.buffer.cols ?? options.canvas?.cols ?? terminal.cols
      const rows = frames[0]?.buffer.rows ?? options.canvas?.rows ?? terminal.rows
      return traceToRecording({
        frames,
        cols,
        rows,
        backend: terminal.backend.name,
        ...(options.canvas !== undefined ? { canvas: options.canvas } : {}),
      })
    },
    writeTrec(trecDir: string): void {
      // Project the captured trace into a Recording, then serialize it to a
      // `.trec` directory. The unique-frame PNGs are copied from the tracer's
      // live trace `dir` (where `captureFrame` wrote them).
      const cols = frames[0]?.buffer.cols ?? options.canvas?.cols ?? terminal.cols
      const rows = frames[0]?.buffer.rows ?? options.canvas?.rows ?? terminal.rows
      const recording = traceToRecording({
        frames,
        cols,
        rows,
        backend: terminal.backend.name,
        ...(options.canvas !== undefined ? { canvas: options.canvas } : {}),
      })
      writeRecording(trecDir, recording, { pngSourceDir: dir })
    },
    get truncated() {
      return truncated
    },
    get count() {
      return frames.length
    },
  }
}
