/**
 * The `view` module — every Recording-presentation surface.
 *
 * Phase 3 of the Recording-domain unification (design doc §5). Before this
 * phase, presentation was scattered: a scrubbable-HTML viewer module, separate
 * GIF/APNG/animated-SVG encoders, and the CLI's HTML slideshow. They are all
 * `view` targets and now live under this one module.
 *
 * The `view` *verb* itself is `../view.ts` — given a {@link Recording} it
 * presents it (`mode: "scrub" | "animate"`, sink = file). This barrel exposes
 * the lower-level building blocks the verb composes.
 */

// Scrubbable HTML viewer — the canonical viewer.
export { writeViewer, writeViewerFromRecording } from "./viewer.ts"
export type { WriteViewerResult } from "./viewer.ts"

// SVG slideshow — the simple auto-play `view` mode for live SVG captures.
export { generateSlideshow } from "./slideshow.ts"
export type { SlideshowFrame } from "./slideshow.ts"

// Animation output formats (animated SVG, GIF, APNG).
export { createAnimatedSvg } from "./animated-svg.ts"
export { createGif, createGifFromPngs } from "./gif.ts"
export type { PngFrame } from "./gif.ts"
export { createApng } from "./apng.ts"
export { renderAnimation, detectFormat } from "./animation.ts"
export { frameLayers, rasterizeFrameLayers } from "./frame-layers.ts"
export type {
  AnimationFrame,
  AnimationOptions,
  AnimationFormat,
  FrameLayer,
  FrameLayerOffset,
} from "./animation-types.ts"

// Recording-domain bridge: derive animation frames from a Recording.
export { recordingToPngFrames, recordingToAnimationFrames } from "./from-recording.ts"
export type { FromRecordingOptions } from "./from-recording.ts"
