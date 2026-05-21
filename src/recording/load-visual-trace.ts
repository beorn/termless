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

import { existsSync } from "node:fs"
import { join } from "node:path"
import { readRecording } from "./native/native-trec.ts"
import type { Recording } from "./recording.ts"

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
 * Load an on-disk frame-trace directory into an in-memory {@link Recording}.
 *
 * Phase 5 update: `loadVisualTrace` now **delegates to {@link readRecording}**,
 * the native `.trec` reader. `readRecording` accepts both a full `.trec`
 * directory and a bare legacy frame-trace directory (`index.jsonl` +
 * `NNNNN.png`, no `manifest.json`) — so `loadVisualTrace` keeps its exact
 * contract (a frame-trace directory in, a `Recording` out) while the native
 * `.trec` format owns the read path. km's `toMatchVisualTrace` calling
 * `loadVisualTrace` transparently gains `.trec` support.
 *
 * Terminal geometry (`cols`/`rows`) is taken from the first frame's buffer.
 * `provenance.reproducible` is `false`: a bare frame trace records no `io`
 * track, so the visual state is the sole record.
 *
 * @param path Path to a frame-trace directory (`index.jsonl` + `NNNNN.png`),
 *   or a full `.trec` directory.
 * @param options See {@link LoadVisualTraceOptions}.
 * @returns A {@link Recording} with a populated `frames` projection.
 * @throws {Error} when `<path>` is neither a frame-trace directory nor a
 *   `.trec` directory, or when it contains no parseable frames.
 */
export function loadVisualTrace(path: string, options: LoadVisualTraceOptions = {}): Recording {
  // Preserve the historical error message for a missing frame-trace index so
  // existing callers/tests that match on it keep passing.
  const indexFile = join(path, "index.jsonl")
  const manifestFile = join(path, "manifest.json")
  if (!existsSync(indexFile) && !existsSync(manifestFile)) {
    throw new Error(`loadVisualTrace: no index.jsonl found at ${indexFile}`)
  }
  return readRecording(path, { backend: options.backend ?? "unknown" })
}
