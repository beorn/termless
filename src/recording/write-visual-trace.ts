/**
 * `writeVisualTrace` — write a frame-trace directory to disk.
 *
 * Phase 4 of the Recording-domain unification (design doc §6). The disk-*writing*
 * sibling of {@link "./load-visual-trace.ts"}'s `loadVisualTrace`. Together they
 * hand the frame-trace directory layout — a **cross-repo ABI** — back to
 * termless: km's `toMatchVisualTrace` matcher writes a golden trace by calling
 * `writeVisualTrace` and never touches the on-disk shape itself, so Phase 5 is
 * free to change the format without breaking km.
 *
 * The on-disk layout this writes is exactly what {@link "./frame-trace.ts"}'s
 * `createFrameTracer` produces:
 *
 *   trace-dir/
 *     index.jsonl    — one {@link TraceFrame} per line, in `seq` order
 *     00001.png      — unique frames only; duplicates point back via duplicate_of
 *     ...
 *
 * Unlike `createFrameTracer` (which appends frames *as they are captured*),
 * `writeVisualTrace` writes a *complete, already-captured* trace in one shot:
 * the destination directory is wiped, the `index.jsonl` is written whole, and
 * every unique frame's PNG is copied from a source directory.
 *
 * Operating on the tracer's `TraceFrame` shape (not the in-memory `Recording`) is
 * deliberate: a golden trace must round-trip byte-identically through
 * `writeVisualTrace` → `loadVisualTrace`, and the `TraceFrame` shape carries fields
 * (`render_ms`, `duration_since_prev_ms`, `iso`) the `Recording` projection
 * drops. Writing from `TraceFrame[]` keeps the on-disk bytes lossless.
 */

import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { recordingToTraceFrames } from "./frame-trace-recording.ts"
import type { TraceFrame } from "./frame-trace.ts"
import type { Recording } from "./recording.ts"

/** Options for {@link writeVisualTrace}. */
export interface WriteVisualTraceOptions {
  /**
   * Directory the unique-frame PNGs are copied *from*. Each frame's `png`
   * field is a relative filename resolved against this directory. When a
   * referenced PNG is missing it is skipped (the index still records the
   * frame) — mirroring the tracer's render-failure tolerance.
   *
   * Omit when the trace carries no PNGs (every frame's `png` is `null`).
   */
  pngSourceDir?: string
}

/**
 * Write a complete frame-trace directory to `dir`.
 *
 * The destination directory is **wiped and recreated** — `writeVisualTrace`
 * produces a clean trace directory, never merges into an existing one. The
 * `index.jsonl` is written with one frame per line in array order; every
 * unique frame's PNG (`frame.png !== null`) is copied from
 * {@link WriteVisualTraceOptions.pngSourceDir} preserving its filename, so the
 * `duplicate_of` chains still resolve.
 *
 * @param dir Destination frame-trace directory. Created if missing; its prior
 *   contents are removed.
 * @param frames The complete, already-captured trace frames (e.g. from a
 *   tracer's `framesSinceSeq(0)`).
 * @param options See {@link WriteVisualTraceOptions}.
 */
export function writeVisualTrace(dir: string, frames: TraceFrame[], options: WriteVisualTraceOptions = {}): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
  mkdirSync(dir, { recursive: true })

  // Copy every unique frame's PNG, preserving its filename so duplicate_of
  // chains keep resolving against the written directory.
  if (options.pngSourceDir !== undefined) {
    for (const frame of frames) {
      if (frame.png === null) continue
      const src = join(options.pngSourceDir, frame.png)
      if (!existsSync(src)) continue
      copyFileSync(src, join(dir, frame.png))
    }
  }

  // Write index.jsonl whole — one Frame per line, trailing newline when
  // non-empty (matches the tracer's append-with-newline output).
  const body = frames.map((f) => JSON.stringify(f)).join("\n") + (frames.length > 0 ? "\n" : "")
  writeFileSync(join(dir, "index.jsonl"), body)
}

/**
 * Write a visual trace directory from the canonical {@link Recording} noun.
 *
 * The recomposed counterpart of {@link writeVisualTrace}: rather than taking
 * raw on-disk `TraceFrame[]`, it takes the `Recording` whose `frames`
 * projection *is* the trace and serializes it through the shared
 * {@link recordingToTraceFrames} codec. For a Recording whose frames carry
 * {@link "./recording.ts" | RenderArtifacts} (any trace loaded via
 * `loadVisualTrace`), the emitted `index.jsonl` is **byte-identical** to what
 * the legacy raw-`TraceFrame[]` path would write — the recomposition's
 * lossless guarantee, proven in `tests/trace-recomposition.test.ts`.
 *
 * This is what lets the visual-trace format be expressed entirely over the
 * canonical Recording noun: the frame tracer produces a `Recording`, and the
 * on-disk `TraceFrame` row is merely its serialization.
 *
 * @param dir Destination frame-trace directory. Wiped and recreated, exactly
 *   as {@link writeVisualTrace}.
 * @param recording The recording whose `frames` projection is written.
 * @param options See {@link WriteVisualTraceOptions}.
 */
export function writeVisualTraceFromRecording(
  dir: string,
  recording: Recording,
  options: WriteVisualTraceOptions = {},
): void {
  writeVisualTrace(dir, recordingToTraceFrames(recording), options)
}
