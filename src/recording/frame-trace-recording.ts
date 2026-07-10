/**
 * frame-trace → `Recording` adapter — projects a frame trace into the
 * in-memory {@link Recording} model's `frames` projection.
 *
 * Phase 2 of the Recording-domain unification (design doc §3, §6). The
 * frame-trace artifact ({@link "./frame-trace.ts"}) captures rendered visual
 * states; in the unified model those are the `frames` **projection** — a
 * materialized view of `io × Renderer × snapshot-policy`, not a co-equal
 * source track.
 *
 * This module is a **pure projection** — it touches no disk. The frame
 * tracer's `index.jsonl` + `NNNNN.png` writing is byte-untouched; this
 * adapter only re-shapes the tracer's *in-memory* `Frame[]` into the model.
 *
 * Timebase — the on-disk frame-trace `Frame.ts` is a **wall-clock ms epoch**.
 * The Recording model's clock is **integer µs relative to recording start**.
 * The adapter rebases: `at = (frame.ts − firstTs) × 1000`.
 *
 * Renderer fingerprint — the on-disk frame trace does not record a renderer
 * fingerprint per frame (the layout is frozen). The adapter synthesizes one
 * {@link RendererFingerprint} for the whole trace from the
 * {@link FrameTraceOptions.canvas} options the tracer was created with, and
 * stamps every projected frame with it.
 */

import {
  type Frame as ModelFrame,
  type Micros,
  type Recording,
  type RendererFingerprint,
  createRecording,
  micros,
} from "./recording.ts"
import type { TraceFrame } from "./frame-trace.ts"
import type { ScreenshotOptions } from "../terminal/types.ts"

/** Canvas options the frame tracer was created with — the fingerprint source. */
export type TraceCanvasOptions = Pick<ScreenshotOptions, "cols" | "rows" | "fontSize" | "fontPath" | "theme" | "dpr">

/** Input for {@link traceToRecording}. */
export interface TraceToRecordingInput {
  /** The in-memory frame-trace frames (e.g. `tracer.framesSinceSeq(0)`). */
  frames: TraceFrame[]
  /** Terminal columns at trace start. */
  cols: number
  /** Terminal rows at trace start. */
  rows: number
  /** Backend id the frames were rendered with (e.g. `"ghostty"`). */
  backend: string
  /** Canvas render options the tracer used — source of the fingerprint. */
  canvas?: TraceCanvasOptions
  /**
   * Whether the `frames` projection can be regenerated from an `io` track.
   * A bare frame trace has no `io` track recorded, so the visual state is the
   * sole record — pass `false` for a frame-trace-only recording (default).
   */
  reproducible?: boolean
}

/** Default fingerprint values when the tracer carried no explicit canvas opts. */
const FINGERPRINT_DEFAULTS = {
  fontFamily: "JetBrains Mono",
  fontSize: 14,
  cellWidth: 8,
  cellHeight: 16,
  dpr: 2,
  theme: "default",
}

/**
 * Synthesize a {@link RendererFingerprint} for a whole trace from the canvas
 * options the tracer ran with. The on-disk frame-trace layout has no
 * per-frame fingerprint slot (it is frozen) — the unified model wants one, so
 * we derive a single trace-wide fingerprint and stamp it on every frame.
 */
export function fingerprintFromCanvas(backend: string, canvas?: TraceCanvasOptions): RendererFingerprint {
  const fontSize = canvas?.fontSize ?? FINGERPRINT_DEFAULTS.fontSize
  const dpr = canvas?.dpr ?? FINGERPRINT_DEFAULTS.dpr
  // Cell size is not in ScreenshotOptions; derive a nominal cell box from the
  // font size (canvas renderers use ~0.6 advance width, ~1.2 line height).
  return {
    backend,
    fontFamily: FINGERPRINT_DEFAULTS.fontFamily,
    fontSize,
    cellSize: {
      width: Math.round(fontSize * 0.6 * dpr),
      height: Math.round(fontSize * 1.2 * dpr),
    },
    dpr,
    theme:
      typeof canvas?.theme === "string"
        ? canvas.theme
        : canvas?.theme !== undefined
          ? "custom"
          : FINGERPRINT_DEFAULTS.theme,
  }
}

/** Project one on-disk-shaped {@link TraceFrame} into a model {@link ModelFrame}. */
function projectFrame(frame: TraceFrame, firstTs: number, fingerprint: RendererFingerprint): ModelFrame {
  const at: Micros = micros(Math.max(0, Math.round((frame.ts - firstTs) * 1000)))
  const model: ModelFrame = {
    seq: frame.seq,
    at,
    contentHash: frame.hash,
    duplicateOf: frame.duplicate_of,
    fingerprint,
    buffer: {
      cols: frame.buffer.cols,
      rows: frame.buffer.rows,
      cursor: { row: frame.buffer.cursor.row, col: frame.buffer.cursor.col },
    },
    ansiPreview: frame.ansi_input_preview,
    bytesInSinceLast: frame.bytes_in_since_last,
    png: frame.png,
    // Render-capture artifacts: the on-disk trace's absolute wall-clock `ts`
    // and its per-frame `render_ms`. `iso` and inter-frame `duration` derive
    // from `ts`, so the two artifacts are all the projection needs to be a
    // lossless carrier — the inverse {@link recordingToTraceFrames} rebuilds
    // the full on-disk row from them.
    artifacts: { wallClockMs: frame.ts, renderMs: frame.render_ms },
  }
  // Carry the silvery render-state snapshot when the on-disk frame had one.
  // It is structurally the model's `signal` shape; copy only the two fields
  // the model declares so an arbitrary legacy payload can't leak in.
  const silvery = frame.silvery
  if (
    silvery !== undefined &&
    silvery !== null &&
    typeof silvery === "object" &&
    "dirtyRegions" in silvery &&
    "signalDelta" in silvery
  ) {
    const s = silvery as {
      dirtyRegions: { row: number; height: number }[]
      signalDelta: {
        nodesVisited: number
        nodesRendered: number
        nodesSkipped: number
        incremental: boolean
      }
    }
    model.signal = { dirtyRegions: s.dirtyRegions, signalDelta: s.signalDelta }
  }
  return model
}

/**
 * Build a {@link Recording} whose `frames` projection is populated from a
 * frame trace.
 *
 * The result carries only the `frames` projection — a bare frame trace has no
 * `commands` or `io` source track. `provenance.reproducible` defaults to
 * `false`: with no `io` track recorded, the visual state is the sole record.
 *
 * @throws {Error} when `frames` is empty — {@link createRecording} rejects an
 *   all-empty recording.
 */
export function traceToRecording(input: TraceToRecordingInput): Recording {
  const { frames, cols, rows, backend, canvas } = input
  if (frames.length === 0) {
    throw new Error("traceToRecording: frame trace is empty — no frames projection to build")
  }
  const fingerprint = fingerprintFromCanvas(backend, canvas)
  const firstTs = frames[0]!.ts
  const projected = frames.map((f) => projectFrame(f, firstTs, fingerprint))
  const lastTs = frames[frames.length - 1]!.ts
  const durationMicros = micros(Math.max(0, Math.round((lastTs - firstTs) * 1000)))
  return createRecording({
    cols,
    rows,
    durationMicros,
    frames: projected,
    provenance: { reproducible: input.reproducible ?? false },
  })
}

/**
 * Project one model {@link ModelFrame} back to the on-disk {@link TraceFrame}
 * row — the inverse of {@link projectFrame}.
 *
 * Render artifacts drive the reconstruction when present: `ts` is the frame's
 * absolute `wallClockMs`, `render_ms` its `renderMs`, and `iso` derives from
 * `ts`. When a frame has **no** artifacts (e.g. one derived from an `io` track
 * rather than a visual trace), the on-disk `ts` falls back to the µs-from-start
 * position downscaled to ms (epoch 0), `render_ms` to `0`, and `iso` to the
 * empty string — the honest "no capture provenance" encoding.
 *
 * `duration_since_prev_ms` is recomputed from the reconstructed `ts` stream,
 * exactly as the frame tracer computes it at capture time.
 */
function unprojectFrame(frame: ModelFrame, prevTs: number | null): TraceFrame {
  const hasArtifacts = frame.artifacts !== undefined
  const ts = frame.artifacts?.wallClockMs ?? Math.round(frame.at / 1000)
  const trace: TraceFrame = {
    seq: frame.seq,
    ts,
    iso: hasArtifacts ? new Date(ts).toISOString() : "",
    hash: frame.contentHash,
    duplicate_of: frame.duplicateOf,
    bytes_in_since_last: frame.bytesInSinceLast,
    ansi_input_preview: frame.ansiPreview,
    buffer: {
      cols: frame.buffer.cols,
      rows: frame.buffer.rows,
      cursor: { row: frame.buffer.cursor.row, col: frame.buffer.cursor.col },
    },
    duration_since_prev_ms: prevTs === null ? 0 : ts - prevTs,
    render_ms: frame.artifacts?.renderMs ?? 0,
    png: frame.png,
  }
  // Re-attach the silvery join event when the frame carried a render-state
  // snapshot. The model's `signal` is the dependency-free subset of the raw
  // `SilveryRenderEvent`; the extra join fields (renderCount, reason, ts,
  // fiberHash) are not carried on the projection and are not reconstructed —
  // a silvery-annotated trace is therefore not byte-lossless on that one
  // field. Traces recorded without a silvery sidecar (the harness default)
  // carry no `signal` and round-trip byte-for-byte.
  if (frame.signal !== undefined) trace.silvery = { type: "RENDER_DISPATCHED", ...frame.signal }
  return trace
}

/**
 * Project a {@link Recording}'s `frames` projection back to the on-disk
 * `TraceFrame[]` shape — the inverse of {@link traceToRecording}.
 *
 * This is the single, shared Recording → visual-trace codec: `native-rec`'s
 * `.rec` writer, `writeVisualTraceFromRecording`, and the viewer's
 * Recording-consuming entry point all route through it, so there is exactly
 * one Frame → TraceFrame projection in termless (not three ad-hoc copies).
 *
 * For a trace whose frames carry {@link RenderArtifacts} (the output of
 * {@link traceToRecording}), the round-trip
 * `recordingToTraceFrames(traceToRecording(rows))` equals `rows` byte-for-byte
 * — the recomposition's lossless guarantee.
 *
 * A recording with no `frames` projection yields an empty array.
 */
export function recordingToTraceFrames(recording: Recording): TraceFrame[] {
  const frames = recording.frames ?? []
  const result: TraceFrame[] = []
  let prevTs: number | null = null
  for (const frame of frames) {
    const trace = unprojectFrame(frame, prevTs)
    result.push(trace)
    prevTs = trace.ts
  }
  return result
}
