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
  PngScreenshotOptions,
  RegionView,
  RGB,
  RowView,
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

// Animation output formats (animated SVG, GIF, APNG)
export { createAnimatedSvg } from "./animation/animated-svg.ts"
export { createGif } from "./animation/gif.ts"
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
export type {
  AsciicastHeader,
  AsciicastTheme,
  AsciicastEvent,
  AsciicastEventType,
  AsciicastRecording,
} from "./asciicast/types.ts"
