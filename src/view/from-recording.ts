/**
 * `Recording` → animation-frame bridge.
 *
 * Phase 2 of the Recording-domain unification (design doc §5). The animation
 * encoders ({@link "./gif.ts"}, {@link "./apng.ts"}, {@link "./animated-svg.ts"})
 * consume low-level frame lists — `PngFrame[]` (pre-rasterized) or
 * `AnimationFrame[]` (SVG). This bridge derives those lists from a unified
 * {@link Recording}'s `frames` projection so the animation encoders consume a
 * `Recording` rather than an ad-hoc shape assembled by each caller.
 *
 * Per-frame **duration** is derived from the recording's µs timeline: a
 * frame displays until the next frame's timestamp. The final frame uses a
 * caller-supplied trailing duration (it has no successor on the timeline).
 *
 * The frames projection stores `png` as a path *relative to the recording
 * bundle*. {@link recordingToPngFrames} reads those PNGs from `bundleDir`,
 * resolving deduped frames (`duplicateOf`) to the original frame's image.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Frame as ModelFrame, Recording } from "../recording/recording.ts"
import type { AnimationFrame } from "./animation-types.ts"
import type { PngFrame } from "./gif.ts"

/** Options for deriving animation frames from a {@link Recording}. */
export interface FromRecordingOptions {
  /**
   * Display duration (ms) for the final frame — it has no successor on the
   * timeline to bound it. Default: 100ms.
   */
  trailingDurationMs?: number
  /**
   * Include visual-duplicate frames (`duplicateOf != null`). When `false`
   * (default) duplicate frames are merged into their predecessor's duration —
   * the animation skips redundant identical stills.
   */
  includeDuplicates?: boolean
}

/** Compute the display duration (ms) for the model frame at `index`. */
function durationMsFor(frames: ModelFrame[], index: number, trailingMs: number): number {
  const next = frames[index + 1]
  if (next === undefined) return trailingMs
  return Math.max(0, Math.round((next.at - frames[index]!.at) / 1000))
}

/**
 * Resolve the on-disk PNG path for a frame, following `duplicateOf` for
 * deduped frames (which carry `png: null`).
 */
function pngPathFor(recording: Recording, frame: ModelFrame): string | null {
  if (frame.png !== null) return frame.png
  if (frame.duplicateOf !== null) {
    const original = recording.frames!.find((f) => f.seq === frame.duplicateOf)
    if (original?.png != null) return original.png
  }
  return null
}

/**
 * Derive {@link PngFrame}[] from a {@link Recording}'s `frames` projection,
 * reading the rasterized PNGs from `bundleDir`.
 *
 * @throws {Error} when the recording has no `frames` projection, or a
 *   non-duplicate frame has no resolvable PNG.
 */
export function recordingToPngFrames(
  recording: Recording,
  bundleDir: string,
  options?: FromRecordingOptions,
): PngFrame[] {
  const modelFrames = recording.frames
  if (modelFrames === undefined || modelFrames.length === 0) {
    throw new Error("recordingToPngFrames: recording has no frames projection")
  }
  const trailingMs = options?.trailingDurationMs ?? 100
  const includeDuplicates = options?.includeDuplicates ?? false

  const result: PngFrame[] = []
  for (let i = 0; i < modelFrames.length; i++) {
    const frame = modelFrames[i]!
    const isDuplicate = frame.duplicateOf !== null
    if (isDuplicate && !includeDuplicates) {
      // Merge this still into the previous frame's display time.
      if (result.length > 0) {
        result[result.length - 1]!.duration += durationMsFor(modelFrames, i, trailingMs)
      }
      continue
    }
    const path = pngPathFor(recording, frame)
    if (path === null) {
      throw new Error(`recordingToPngFrames: frame ${frame.seq} has no resolvable PNG`)
    }
    result.push({
      png: new Uint8Array(readFileSync(join(bundleDir, path))),
      duration: durationMsFor(modelFrames, i, trailingMs),
    })
  }
  return result
}

/**
 * Derive {@link AnimationFrame}[] (SVG-backed) from a {@link Recording} and a
 * per-frame SVG renderer.
 *
 * The frames projection stores rasterized PNGs, not SVG — so the caller
 * supplies `renderSvg`, a function that produces the SVG for a frame's
 * `contentHash` (or by `seq`). This keeps the bridge renderer-agnostic: the
 * Renderer strategy (design doc §5) lives outside.
 */
export function recordingToAnimationFrames(
  recording: Recording,
  renderSvg: (frame: ModelFrame) => string,
  options?: FromRecordingOptions,
): AnimationFrame[] {
  const modelFrames = recording.frames
  if (modelFrames === undefined || modelFrames.length === 0) {
    throw new Error("recordingToAnimationFrames: recording has no frames projection")
  }
  const trailingMs = options?.trailingDurationMs ?? 100
  const includeDuplicates = options?.includeDuplicates ?? false

  const result: AnimationFrame[] = []
  for (let i = 0; i < modelFrames.length; i++) {
    const frame = modelFrames[i]!
    if (frame.duplicateOf !== null && !includeDuplicates) {
      if (result.length > 0) {
        result[result.length - 1]!.duration += durationMsFor(modelFrames, i, trailingMs)
      }
      continue
    }
    result.push({ svg: renderSvg(frame), duration: durationMsFor(modelFrames, i, trailingMs) })
  }
  return result
}
