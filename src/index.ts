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
export { screenshotSvg } from "./svg.ts"
export { screenshotPng } from "./png.ts"
// Backwards-compat re-export: @termless/ghostty owns the cellsToAnsi + canvas
// renderer surface in Phase 9+. The barrel re-exports cellsToAnsi so any
// caller still doing `import { cellsToAnsi } from "@termless/core"` keeps
// working without pulling the full ghostty backend.
export { cellsToAnsi } from "@termless/ghostty"
export type { CanvasTheme } from "@termless/ghostty"
export { createFrameTracer } from "./frame-trace.ts"
export type { Frame, FrameTraceOptions, FrameTraceSummary, FrameTracer } from "./frame-trace.ts"
export { writeViewer } from "./frame-viewer.ts"
export type { WriteViewerResult } from "./frame-viewer.ts"
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

// Recording and replay
export { startRecording, replayRecording, snapshotVisualState } from "./recording.ts"
export type { RecordedEvent, Recording, RecordingHandle } from "./recording.ts"

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
export type { TapeExecutorOptions, TapeFrame, TapeResult } from "./tape/executor.ts"
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

// Animation output formats (animated SVG, GIF, APNG)
export { createAnimatedSvg } from "./animation/animated-svg.ts"
export { createGif, createGifFromPngs } from "./animation/gif.ts"
export type { PngFrame } from "./animation/gif.ts"
export { createApng } from "./animation/apng.ts"
export { renderAnimation, detectFormat } from "./animation/index.ts"
export type { AnimationFrame, AnimationOptions, AnimationFormat } from "./animation/types.ts"

// Asciicast v2 format
export { parseAsciicast, replayAsciicast } from "./asciicast/reader.ts"
export type { ReplayOptions } from "./asciicast/reader.ts"
export { toAsciicast, createAsciicastWriter } from "./asciicast/writer.ts"
export type { ToAsciicastOptions, AsciicastWriter } from "./asciicast/writer.ts"
export { recordingToAsciicast, asciicastToRecording } from "./asciicast/convert.ts"
export type { ConvertOptions } from "./asciicast/convert.ts"
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
