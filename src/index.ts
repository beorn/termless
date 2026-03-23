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
export type { AssertionResult } from "./assertions.ts"

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
export { backend, isReady, backends, entry, manifest, buildBackend, createTerminalByName, ensureCachedVersion } from "./backends.ts"
export type { BackendEntry, Manifest, ResolveOptions } from "./backends.ts"
