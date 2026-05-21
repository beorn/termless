/**
 * `loadVisualTrace` — read an on-disk frame-trace directory into a
 * {@link Recording}.
 *
 * Phase 4 of the Recording-domain unification (design doc §6). The frame-trace
 * directory layout (`index.jsonl` + `NNNNN.png`) is a **cross-repo ABI** — km's
 * `toMatchVisualTrace` matcher parses it directly. This module inserts the
 * indirection that hands the layout back to termless: km calls
 * `loadVisualTrace` and never touches the on-disk shape again, so Phase 5 is
 * free to change the format without breaking km.
 *
 * The on-disk layout this reads is exactly what {@link "./frame-trace.ts"}'s
 * `createFrameTracer` writes:
 *
 *   trace-dir/
 *     index.jsonl    — append-only, one {@link Frame} per line
 *     00001.png      — unique frames only; duplicates point back via duplicate_of
 *     ...
 *     viewer.html    — ignored here
 *
 * `loadVisualTrace` is the disk-reading sibling of Phase 2's pure in-memory
 * {@link traceToRecording}: it parses `index.jsonl` into `Frame[]` and then
 * delegates to the same projection. Reading is **tolerant** — a truncated or
 * malformed final line is skipped, mirroring the tracer's append-only design.
 *
 * PNG bytes are NOT loaded into memory. The frames projection carries each
 * frame's `png` field as a relative filename (unchanged from disk); a consumer
 * that needs the bytes resolves them against the trace directory itself.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { traceToRecording } from "./frame-trace-recording.ts"
import type { Frame } from "./frame-trace.ts"
import type { Recording } from "./recording-model.ts"

/** Options for {@link loadVisualTrace}. */
export interface LoadVisualTraceOptions {
  /**
   * Backend id stamped onto the synthesized renderer fingerprint of every
   * projected frame. The on-disk frame-trace layout records no backend, so it
   * must be supplied (or defaults). Default: `"unknown"`.
   */
  backend?: string
}

/**
 * Parse a frame-trace `index.jsonl` into `Frame[]`.
 *
 * One JSON object per line. Tolerant: blank lines and malformed lines (e.g. a
 * truncated final line from an interrupted trace) are skipped — matching the
 * append-only, truncation-tolerant design of `frame-trace.ts`.
 */
function parseIndexJsonl(text: string): Frame[] {
  const frames: Frame[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      frames.push(JSON.parse(trimmed) as Frame)
    } catch {
      // Tolerant: skip malformed line (matches frame-trace.ts's design).
    }
  }
  return frames
}

/**
 * Load an on-disk frame-trace directory into an in-memory {@link Recording}.
 *
 * Reads `<path>/index.jsonl`, parses it into the tracer's `Frame[]`, and
 * projects them into a `Recording` whose `frames` projection is populated —
 * the same shape Phase 2's {@link traceToRecording} produces.
 *
 * Terminal geometry (`cols`/`rows`) is taken from the first frame's buffer.
 * `provenance.reproducible` is `false`: a bare frame trace records no `io`
 * track, so the visual state is the sole record.
 *
 * @param path Path to the frame-trace directory (the one holding
 *   `index.jsonl` + `NNNNN.png`).
 * @param options See {@link LoadVisualTraceOptions}.
 * @returns A {@link Recording} with a populated `frames` projection.
 * @throws {Error} when `<path>/index.jsonl` does not exist, or when it
 *   contains no parseable frames (a Recording must carry a non-empty track).
 */
export function loadVisualTrace(path: string, options: LoadVisualTraceOptions = {}): Recording {
  const indexFile = join(path, "index.jsonl")
  if (!existsSync(indexFile)) {
    throw new Error(`loadVisualTrace: no index.jsonl found at ${indexFile}`)
  }
  const frames = parseIndexJsonl(readFileSync(indexFile, "utf-8"))
  if (frames.length === 0) {
    throw new Error(`loadVisualTrace: ${indexFile} contains no parseable frames`)
  }
  const first = frames[0]!
  return traceToRecording({
    frames,
    cols: first.buffer.cols,
    rows: first.buffer.rows,
    backend: options.backend ?? "unknown",
  })
}
