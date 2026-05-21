/**
 * The `view` verb — present a {@link Recording}.
 *
 * Phase 3 of the Recording-domain unification (design doc §2, §5). `view` is
 * one of the four recording-domain verbs (record · **view** · play · compare).
 * It collapses what used to be several separate surfaces — the scrubbable HTML
 * viewer, the HTML slideshow, GIF/APNG/animated-SVG export — into a single
 * verb with a `mode`:
 *
 * - `mode: "scrub"` — the rich scrubbable HTML viewer (timeline scrub, find,
 *   filter, pixel-diff, per-frame metadata). Canonical viewer.
 * - `mode: "animate"` — a GIF / APNG / animated-SVG artifact.
 * - `mode: "web"` — a browser `view` surface (`@termless/web-player`).
 *
 * Writing a GIF to a file is *not* a separate "export" concept — it is just
 * `view` with `mode: "animate"` and a file sink. The sink is the destination
 * (a file path, or — in the future — a window); the mode is the presentation.
 *
 * Per-frame rasterization is delegated to the {@link "./render/index.ts"}
 * Renderer strategy — `view` never rasterizes a buffer itself.
 */

import { writeFileSync } from "node:fs"
import type { Recording } from "./recording/recording.ts"
import { writeViewer, writeViewerFromRecording, type WriteViewerResult } from "./view/viewer.ts"
import { renderAnimation, type AnimationFormat } from "./view/animation.ts"
import { recordingToAnimationFrames, type FromRecordingOptions } from "./view/from-recording.ts"
import type { Frame as ModelFrame } from "./recording/recording.ts"

/** The presentation mode of the `view` verb. */
export type ViewMode = "scrub" | "animate"

/** Options for the scrubbable HTML viewer mode. */
export interface ScrubViewOptions {
  mode: "scrub"
  /**
   * The frame-trace bundle directory — PNGs are inlined from here, and the
   * generated `viewer.html` is written alongside.
   */
  bundleDir: string
}

/** Options for the animation-artifact mode (GIF / APNG / animated SVG). */
export interface AnimateViewOptions {
  mode: "animate"
  /** The animation encoding. */
  format: AnimationFormat
  /** Per-frame SVG renderer — the Renderer strategy for animation frames. */
  renderSvg: (frame: ModelFrame) => string
  /** Destination file path (the file sink). */
  sink: string
  /** Frame-derivation options (trailing duration, duplicate handling). */
  frames?: FromRecordingOptions
  /**
   * The raster renderer for `gif` / `apng` output — `canvas` (high fidelity),
   * `resvg` (cross-platform), or `auto` (default). Ignored for `svg` (vector).
   */
  renderer?: "canvas" | "resvg" | "auto"
}

/** All `view` verb options, discriminated by `mode`. */
export type ViewOptions = ScrubViewOptions | AnimateViewOptions

/**
 * Present a {@link Recording}.
 *
 * - `mode: "scrub"` → writes `viewer.html` into `bundleDir`, returns the
 *   {@link WriteViewerResult}.
 * - `mode: "animate"` → encodes the recording's `frames` projection as a
 *   GIF / APNG / animated SVG and writes it to the `sink` path, returning the
 *   byte length written.
 *
 * @throws {Error} when the recording has no `frames` projection.
 */
export async function view(recording: Recording, options: ScrubViewOptions): Promise<WriteViewerResult>
export async function view(recording: Recording, options: AnimateViewOptions): Promise<number>
export async function view(recording: Recording, options: ViewOptions): Promise<WriteViewerResult | number> {
  if (options.mode === "scrub") {
    return writeViewerFromRecording(recording, options.bundleDir)
  }
  // mode: "animate"
  const frames = recordingToAnimationFrames(recording, options.renderSvg, options.frames)
  const artifact = await renderAnimation(frames, options.format, { renderer: options.renderer ?? "auto" })
  const bytes = typeof artifact === "string" ? Buffer.from(artifact, "utf-8") : artifact
  writeFileSync(options.sink, bytes)
  return bytes.byteLength
}

// Re-export the on-disk-source scrub entry — `writeViewer` parses an existing
// frame-trace `index.jsonl`, the lower-level path beneath `view(.., {scrub})`.
export { writeViewer }
