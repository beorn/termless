/**
 * `loadVisualTrace` — read an on-disk visual trace into a {@link Recording}.
 *
 * The visual-trace layout is a `.tty` bundle whose frames member sits at the
 * bundle root (`index.jsonl` + `NNNNN.png` beside it, one added
 * `manifest.json` declaring the member) — exactly what
 * {@link "./write-visual-trace.ts" | writeVisualTrace} writes. Member paths
 * are declarative, so the historical trace file layout is byte-stable: the
 * frozen `TraceFrame` row ABI and the PNG naming never moved; the manifest is
 * the one addition.
 *
 * km's `toMatchVisualTrace` calls this and never touches the on-disk shape —
 * the indirection that lets the format evolve without breaking km. Reading
 * delegates to the format's one reader ({@link readBundle}), so a visual
 * trace is readable by every `.tty`/`.ttyz` consumer and vice versa.
 *
 * PNG bytes are NOT loaded into memory. The frames projection carries each
 * frame's `png` field as a relative filename (unchanged from disk); a consumer
 * that needs the bytes resolves them against the trace directory itself.
 */

import { existsSync } from "node:fs"
import { join } from "node:path"
import { readBundle } from "./native/tty-format.ts"
import type { Recording } from "./recording.ts"

/** Options for {@link loadVisualTrace}. */
export interface LoadVisualTraceOptions {
  /**
   * Backend id stamped onto the synthesized renderer fingerprint of every
   * projected frame when the trace's manifest carries no fingerprint of its
   * own. Default: `"unknown"`.
   */
  backend?: string
}

/**
 * Load an on-disk visual trace into an in-memory {@link Recording}.
 *
 * Terminal geometry (`cols`/`rows`) is taken from the first frame's buffer
 * when the manifest does not pin one. `provenance.reproducible` is `false`
 * for a frames-only trace: it records no `io` track, so the visual state is
 * the sole record.
 *
 * @param path Path to a visual-trace bundle (`manifest.json` + `index.jsonl`
 *   + `NNNNN.png`).
 * @param options See {@link LoadVisualTraceOptions}.
 * @returns A {@link Recording} with a populated `frames` projection.
 * @throws {Error} when `path` is not a bundle (no manifest) or contains no
 *   parseable frames.
 */
export function loadVisualTrace(path: string, options: LoadVisualTraceOptions = {}): Recording {
  // Preserve the historical error message for a missing trace index so
  // existing callers/tests that match on it keep failing usefully.
  const indexFile = join(path, "index.jsonl")
  const manifestFile = join(path, "manifest.json")
  if (!existsSync(indexFile) && !existsSync(manifestFile)) {
    throw new Error(`loadVisualTrace: no index.jsonl found at ${indexFile}`)
  }
  return readBundle(path, { backendFallback: options.backend ?? "unknown" }).recording
}
