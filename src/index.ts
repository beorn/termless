export type {
  Cell,
  CellView,
  CursorState,
  CursorStyle,
  EmulatorWarning,
  KeyDescriptor,
  MouseEvent,
  MouseModifiers,
  MouseOptions,
  OutputView,
  PngScreenshotOptions,
  RegionView,
  RGB,
  RowView,
  ScreenshotOptions,
  ScrollbackState,
  SpawnOptions,
  SvgScreenshotOptions,
  SvgTheme,
  Terminal,
  TerminalBackend,
  TerminalCapabilities,
  TerminalCreateOptions,
  TerminalMode,
  TerminalOptions,
  TerminalReadable,
  TextPosition,
  UnderlineStyle,
  WarningExtension,
} from "./terminal/types.ts"

export { hasExtension } from "./terminal/types.ts"
export { createTerminal } from "./terminal/terminal.ts"
// Renderer strategy (Phase 3): buffer → pixels (svg/png). Not a domain object.
export { screenshotSvg, screenshotPng } from "./render/index.ts"
export type { Renderer, VectorRenderer, RasterRenderer } from "./render/index.ts"
// The raster renderer — canvas / resvg / auto SVG → pixels strategy.
export { selectRasterizer } from "./view/rasterizer.ts"
export type { RendererKind, Rasterizer, RasterBitmap } from "./view/rasterizer.ts"
// Backwards-compat re-export: @termless/ghostty owns the cellsToAnsi + canvas
// renderer surface in Phase 9+. The barrel re-exports cellsToAnsi so any
// caller still doing `import { cellsToAnsi } from "@termless/core"` keeps
// working without pulling the full ghostty backend.
export { cellsToAnsi } from "@termless/ghostty"
export type { CanvasTheme } from "@termless/ghostty"
export { createFrameTracer } from "./recording/frame-trace.ts"
export type { TraceFrame, FrameTraceOptions, FrameTraceSummary, FrameTracer } from "./recording/frame-trace.ts"
// Recording-domain adapter (Phase 2): frame-trace → Recording frames projection.
export { traceToRecording, recordingToTraceFrames, fingerprintFromCanvas } from "./recording/frame-trace-recording.ts"
export type { TraceToRecordingInput, TraceCanvasOptions } from "./recording/frame-trace-recording.ts"
// Visual-trace disk I/O (Phase 4): own the frame-trace directory layout so
// consumers (km's `toMatchVisualTrace`) read/write through these APIs instead
// of parsing the on-disk shape directly.
export { loadVisualTrace } from "./recording/load-visual-trace.ts"
export type { LoadVisualTraceOptions } from "./recording/load-visual-trace.ts"
export { writeVisualTrace, writeVisualTraceFromRecording } from "./recording/write-visual-trace.ts"
export type { WriteVisualTraceOptions } from "./recording/write-visual-trace.ts"
// Native `.rec` recording format (Phase 5): the canonical full-fidelity
// on-disk form — a single-file ZIP container, superset of the frame-trace
// layout.
export {
  readRecording,
  writeRecording,
  packRecording,
  unpackRecording,
  isRecPath,
  REC_FORMAT_VERSION,
} from "./recording/native/native-rec.ts"
export type { RecManifest, ReadRecordingOptions, WriteRecordingOptions } from "./recording/native/native-rec.ts"
// ZIP container helper backing the `.rec` format.
export { buildZip, parseZip } from "./recording/native/zip-archive.ts"
export type { ZipEntry } from "./recording/native/zip-archive.ts"
// view verb + view/ module (Phase 3): one verb, one viewer, all presentation.
export { view } from "./view.ts"
export type { ViewMode, ViewOptions, ScrubViewOptions, AnimateViewOptions } from "./view.ts"
export { writeViewer, writeViewerFromRecording } from "./view/viewer.ts"
export type { WriteViewerResult } from "./view/viewer.ts"
export { generateSlideshow } from "./view/slideshow.ts"
export type { SlideshowFrame } from "./view/slideshow.ts"
export { captureCrossRenderer, pngDimensions, dHash, hashDistance } from "./compare.ts"
export type { CrossRendererOptions, CrossRendererResult, CrossRendererReport } from "./compare.ts"
export { parseKey, keyToAnsi } from "./terminal/key-mapping.ts"
export { encodeKeyToAnsi } from "./terminal/key-encoding.ts"
export { createCellView, createRegionView, createRowView } from "./terminal/views.ts"
export { termlessMatchers } from "./jest-matchers.ts"
export type { AssertionResult, CellAttrs, CursorProps } from "./assertions.ts"

// Visual diff
export { diffBuffers } from "./terminal/diff.ts"
export type { CellDiff, CellSummary, DiffResult } from "./terminal/diff.ts"

// State digest — one comparison vocabulary for "same terminal state".
export { terminalStateDigest, diffTerminalStates } from "./terminal/state-digest.ts"
export type {
  TerminalStateDigest,
  TerminalStateDigestOptions,
  TerminalStateDiff,
  DigestCursor,
  DigestRow,
  ModeDiff,
  RowDiff,
} from "./terminal/state-digest.ts"

// The unified captured-session model — the canonical Recording type.
export { createRecording, trackAuthority, micros, secondsToMicros, millisToMicros } from "./recording/recording.ts"
export type {
  Recording,
  Command,
  IoEvent,
  IoDirection,
  Frame,
  RenderArtifacts,
  Micros,
  RendererFingerprint,
  RecordingProvenance,
  TrackAuthority,
  CreateRecordingInput,
} from "./recording/recording.ts"
// Visual-state snapshotting — buffer change detection for the `record` verb.
export { snapshotVisualState } from "./recording/visual-snapshot.ts"

// Mock timer for animation testing
export { createMockTimer } from "./terminal/timer.ts"
export type { MockTimerController } from "./terminal/timer.ts"

// Emulator warning registry
export { pushWarning, drainWarnings, hasWarnings, clearWarnings } from "./terminal/warnings.ts"

// Backend registry (core — user-facing)
export {
  backend,
  isReady,
  backends,
  entry,
  manifest,
  buildBackend,
  createTerminalByName,
  ensureCachedVersion,
} from "./backend/backends.ts"
export type { BackendEntry, Manifest, ResolveOptions } from "./backend/backends.ts"

// Tape format (VHS .tape parser, executor, comparison)
export { parseTape, parseDuration } from "./recording/tape/parser.ts"
export type { TapeCommand, TapeFile } from "./recording/tape/parser.ts"
export { executeTape } from "./recording/tape/executor.ts"
export type { TapeExecutorOptions, ScreenshotCapture, TapeResult } from "./recording/tape/executor.ts"
export { compareTape } from "./recording/tape/compare.ts"
export type {
  CompareMode,
  CompareOptions,
  CompareResult,
  BackendScreenshot,
  BackendSpec,
} from "./recording/tape/compare.ts"
export { compareCanvas, composeSideBySide, composeDiff } from "./recording/tape/compare-canvas.ts"
export type {
  CanvasCompareMode,
  CanvasCompareOptions,
  CanvasCompareResult,
  CanvasBackendSpec,
  CanvasBackendResult,
  CanvasBackendFrame,
} from "./recording/tape/compare-canvas.ts"
export { decodePngRgba, encodePng } from "./recording/tape/png-codec.ts"
export type { RgbaImage } from "./recording/tape/png-codec.ts"
export { overlayKeystroke } from "./recording/tape/overlay.ts"
export type { KeyOverlayOptions } from "./recording/tape/overlay.ts"
export { resolveTheme, listThemes, listAliases } from "./recording/tape/themes.ts"
// Recording-domain adapters (Phase 2): .tape compiler + codegen.
export { compileTape, compileTapeSource, terminalForRecording } from "./recording/tape/compile.ts"
export type { CompileTapeOptions, CompileTapeResult } from "./recording/tape/compile.ts"
export { generateTape } from "./recording/tape/codegen.ts"
export type { GenerateTapeOptions } from "./recording/tape/codegen.ts"

// Animation output formats (animated SVG, GIF, APNG) — view/ module (Phase 3)
export { createAnimatedSvg } from "./view/animated-svg.ts"
export { createGif, createGifFromPngs } from "./view/gif.ts"
export type { PngFrame } from "./view/gif.ts"
export { createApng } from "./view/apng.ts"
export { renderAnimation, detectFormat } from "./view/animation.ts"
export { frameLayers, rasterizeFrameLayers } from "./view/frame-layers.ts"
export type {
  AnimationFrame,
  AnimationOptions,
  AnimationFormat,
  FrameLayer,
  FrameLayerOffset,
} from "./view/animation-types.ts"
// Recording-domain bridge (Phase 2): derive animation frames from a Recording.
export { recordingToPngFrames, recordingToAnimationFrames } from "./view/from-recording.ts"
export type { FromRecordingOptions } from "./view/from-recording.ts"

// Asciicast v2 format
export {
  parseJournalFixture,
  replayJournal,
  type JournalReplayEvent,
  type JournalReplayInput,
  type JournalReplayResult,
} from "./recording/journal-replay.ts"
export { parseAsciicast, replayAsciicast } from "./recording/asciicast/reader.ts"
export type { ReplayOptions } from "./recording/asciicast/reader.ts"
export { createAsciicastWriter } from "./recording/asciicast/writer.ts"
export type { AsciicastWriter } from "./recording/asciicast/writer.ts"
// Recording-domain adapter (Phase 2): .cast ⇄ Recording symmetric codec.
export { decodeAsciicast, decodeAsciicastSource, encodeAsciicast } from "./recording/asciicast/recording-codec.ts"
export type { EncodeAsciicastOptions } from "./recording/asciicast/recording-codec.ts"
export type {
  AsciicastHeader,
  AsciicastTheme,
  AsciicastEvent,
  AsciicastEventType,
  AsciicastRecording,
} from "./recording/asciicast/types.ts"
