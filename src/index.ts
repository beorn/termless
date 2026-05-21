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
} from "./types.ts"

export { hasExtension } from "./types.ts"
export { createTerminal } from "./terminal.ts"
// Renderer strategy (Phase 3): buffer → pixels (svg/png). Not a domain object.
export { screenshotSvg, screenshotPng } from "./render/index.ts"
export type { Renderer, VectorRenderer, RasterRenderer } from "./render/index.ts"
// Backwards-compat re-export: @termless/ghostty owns the cellsToAnsi + canvas
// renderer surface in Phase 9+. The barrel re-exports cellsToAnsi so any
// caller still doing `import { cellsToAnsi } from "@termless/core"` keeps
// working without pulling the full ghostty backend.
export { cellsToAnsi } from "@termless/ghostty"
export type { CanvasTheme } from "@termless/ghostty"
export { createFrameTracer } from "./frame-trace.ts"
export type { TraceFrame, FrameTraceOptions, FrameTraceSummary, FrameTracer } from "./frame-trace.ts"
// Recording-domain adapter (Phase 2): frame-trace → Recording frames projection.
export { traceToRecording, fingerprintFromCanvas } from "./frame-trace-recording.ts"
export type { TraceToRecordingInput, TraceCanvasOptions } from "./frame-trace-recording.ts"
// Visual-trace disk I/O (Phase 4): own the frame-trace directory layout so
// consumers (km's `toMatchVisualTrace`) read/write through these APIs instead
// of parsing the on-disk shape directly.
export { loadVisualTrace } from "./load-visual-trace.ts"
export type { LoadVisualTraceOptions } from "./load-visual-trace.ts"
export { writeVisualTrace } from "./write-visual-trace.ts"
export type { WriteVisualTraceOptions } from "./write-visual-trace.ts"
// Native `.trec` recording format (Phase 5): the canonical full-fidelity
// on-disk form — a directory bundle, superset of the frame-trace layout.
export {
  readRecording,
  writeRecording,
  packRecording,
  unpackRecording,
  isTrecPath,
  TREC_FORMAT_VERSION,
} from "./native-trec.ts"
export type { TrecManifest, ReadRecordingOptions, WriteRecordingOptions } from "./native-trec.ts"
// ZIP container helper backing `.trec` pack / unpack.
export { buildZip, parseZip } from "./zip-archive.ts"
export type { ZipEntry } from "./zip-archive.ts"
// view verb + view/ module (Phase 3): one verb, one viewer, all presentation.
export { view } from "./view.ts"
export type { ViewMode, ViewOptions, ScrubViewOptions, AnimateViewOptions } from "./view.ts"
export { writeViewer, writeViewerFromRecording } from "./view/viewer.ts"
export type { WriteViewerResult } from "./view/viewer.ts"
export { generateSlideshow } from "./view/slideshow.ts"
export type { SlideshowFrame } from "./view/slideshow.ts"
export { captureCrossRenderer, pngDimensions } from "./cross-renderer.ts"
export type { CrossRendererOptions, CrossRendererResult, CrossRendererReport } from "./cross-renderer.ts"
export { parseKey, keyToAnsi } from "./key-mapping.ts"
export { encodeKeyToAnsi } from "./key-encoding.ts"
export { createCellView, createRegionView, createRowView } from "./views.ts"
export { termlessMatchers } from "./jest-matchers.ts"
export type { AssertionResult, CellAttrs, CursorProps } from "./assertions.ts"

// Visual diff
export { diffBuffers } from "./diff.ts"
export type { CellDiff, CellSummary, DiffResult } from "./diff.ts"

// The unified captured-session model — the canonical Recording type.
export { createRecording, trackAuthority, micros, secondsToMicros, millisToMicros } from "./recording-model.ts"
export type {
  Recording,
  Command,
  IoEvent,
  IoDirection,
  Frame,
  Micros,
  RendererFingerprint,
  RecordingProvenance,
  TrackAuthority,
  CreateRecordingInput,
} from "./recording-model.ts"
// Visual-state snapshotting — buffer change detection for the `record` verb.
export { snapshotVisualState } from "./recording.ts"

// Mock timer for animation testing
export { createMockTimer } from "./timer.ts"
export type { MockTimerController } from "./timer.ts"

// Emulator warning registry
export { pushWarning, drainWarnings, hasWarnings, clearWarnings } from "./warnings.ts"

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
} from "./backends.ts"
export type { BackendEntry, Manifest, ResolveOptions } from "./backends.ts"

// Tape format (VHS .tape parser, executor, comparison)
export { parseTape, parseDuration } from "./tape/parser.ts"
export type { TapeCommand, TapeFile } from "./tape/parser.ts"
export { executeTape } from "./tape/executor.ts"
export type { TapeExecutorOptions, ScreenshotCapture, TapeResult } from "./tape/executor.ts"
export { compareTape } from "./tape/compare.ts"
export type { CompareMode, CompareOptions, CompareResult, BackendScreenshot, BackendSpec } from "./tape/compare.ts"
export { compareCanvas, composeSideBySide, composeDiff } from "./tape/compare-canvas.ts"
export type {
  CanvasCompareMode,
  CanvasCompareOptions,
  CanvasCompareResult,
  CanvasBackendSpec,
  CanvasBackendResult,
  CanvasBackendFrame,
} from "./tape/compare-canvas.ts"
export { decodePngRgba, encodePng } from "./tape/png-codec.ts"
export type { RgbaImage } from "./tape/png-codec.ts"
export { overlayKeystroke } from "./tape/overlay.ts"
export type { KeyOverlayOptions } from "./tape/overlay.ts"
export { resolveTheme, listThemes, listAliases } from "./tape/themes.ts"
// Recording-domain adapters (Phase 2): .tape compiler + codegen.
export { compileTape, compileTapeSource, terminalForRecording } from "./tape/compile.ts"
export type { CompileTapeOptions, CompileTapeResult } from "./tape/compile.ts"
export { generateTape } from "./tape/codegen.ts"
export type { GenerateTapeOptions } from "./tape/codegen.ts"

// Animation output formats (animated SVG, GIF, APNG) — view/ module (Phase 3)
export { createAnimatedSvg } from "./view/animated-svg.ts"
export { createGif, createGifFromPngs } from "./view/gif.ts"
export type { PngFrame } from "./view/gif.ts"
export { createApng } from "./view/apng.ts"
export { renderAnimation, detectFormat } from "./view/animation.ts"
export type { AnimationFrame, AnimationOptions, AnimationFormat } from "./view/animation-types.ts"
// Recording-domain bridge (Phase 2): derive animation frames from a Recording.
export { recordingToPngFrames, recordingToAnimationFrames } from "./view/from-recording.ts"
export type { FromRecordingOptions } from "./view/from-recording.ts"

// Asciicast v2 format
export { parseAsciicast, replayAsciicast } from "./asciicast/reader.ts"
export type { ReplayOptions } from "./asciicast/reader.ts"
export { createAsciicastWriter } from "./asciicast/writer.ts"
export type { AsciicastWriter } from "./asciicast/writer.ts"
// Recording-domain adapter (Phase 2): .cast ⇄ Recording symmetric codec.
export { decodeAsciicast, decodeAsciicastSource, encodeAsciicast } from "./asciicast/recording-codec.ts"
export type { EncodeAsciicastOptions } from "./asciicast/recording-codec.ts"
export type {
  AsciicastHeader,
  AsciicastTheme,
  AsciicastEvent,
  AsciicastEventType,
  AsciicastRecording,
} from "./asciicast/types.ts"
