/**
 * `termless/rec` — Recording, codecs, journal-replay. No engine: everything
 * here operates on the {@link Recording} data model (or frames derived from
 * one), never on a live named backend.
 *
 * `Recording` is the primary immutable object; a session is a transient
 * writer into it. This subpath covers the whole lifecycle around that object:
 * build one (capture), serialize/deserialize one (codecs), and present one
 * (replay/view) — but not the `.tty`/`.ttyz` container itself (`termless/fmt`)
 * and not backend selection (`termless/backends`).
 */

// ── The Recording model ─────────────────────────────────────────────────
export { createRecording, trackAuthority, micros, secondsToMicros, millisToMicros } from "@termless/core"
export type {
  Command,
  CreateRecordingInput,
  Frame,
  IoDirection,
  IoEvent,
  Micros,
  Recording,
  RecordingProvenance,
  RendererFingerprint,
  RenderArtifacts,
  TrackAuthority,
} from "@termless/core"

// ── Capture: frame-trace + visual-trace, and their Recording bridges ─────
export { createFrameTracer, snapshotVisualState } from "@termless/core"
export type { FrameTraceOptions, FrameTracer, FrameTraceSummary, TraceFrame } from "@termless/core"
export { fingerprintFromCanvas, recordingToTraceFrames, traceToRecording } from "@termless/core"
export type { TraceCanvasOptions, TraceToRecordingInput } from "@termless/core"
export { loadVisualTrace, writeVisualTrace, writeVisualTraceFromRecording } from "@termless/core"
export type { LoadVisualTraceOptions, WriteVisualTraceOptions } from "@termless/core"

// ── journal-replay ────────────────────────────────────────────────────────
export { parseJournalFixture, replayJournal } from "@termless/core"
export type { JournalReplayEvent, JournalReplayInput, JournalReplayResult, JournalReplayTarget } from "@termless/core"

// ── Codecs: asciicast (.cast, symmetric) and ttyrec (import-only) ────────
export {
  decodeAsciicast,
  decodeAsciicastSource,
  encodeAsciicast,
  parseAsciicast,
  replayAsciicast,
} from "@termless/core"
export { createAsciicastWriter } from "@termless/core"
export { decodeTtyrec } from "@termless/core"
export type {
  AsciicastEvent,
  AsciicastEventType,
  AsciicastHeader,
  AsciicastRecording,
  AsciicastTheme,
  AsciicastWriter,
  DecodeTtyrecOptions,
  EncodeAsciicastOptions,
  ReplayOptions,
} from "@termless/core"

// ── Replay/view: the `view` verb (scrub/animate a Recording), and the ─────
// ── frame/animation-export machinery it is built from ─────────────────────
export { view, writeViewer, writeViewerFromRecording, generateSlideshow } from "@termless/core"
export type {
  AnimateViewOptions,
  ScrubViewOptions,
  SlideshowFrame,
  ViewMode,
  ViewOptions,
  WriteViewerResult,
} from "@termless/core"
export {
  createAnimatedSvg,
  createApng,
  createGif,
  createGifFromPngs,
  detectFormat,
  renderAnimation,
} from "@termless/core"
export { frameLayers, rasterizeFrameLayers, recordingToAnimationFrames, recordingToPngFrames } from "@termless/core"
export type {
  AnimationFormat,
  AnimationFrame,
  AnimationOptions,
  FrameLayer,
  FrameLayerOffset,
  FromRecordingOptions,
  PngFrame,
} from "@termless/core"
