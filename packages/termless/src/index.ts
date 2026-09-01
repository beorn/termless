/**
 * `termless` — the curated top: `createTerminal` and the common path for
 * driving and inspecting a single terminal instance. No engine: a backend
 * still comes from a backend package (`@termless/vterm`, `@termless/xtermjs`,
 * …) or, when you need to pick one by name, from `termless/backends`.
 *
 * ```typescript
 * import { createTerminal } from "termless"
 * import { createVtermBackend } from "@termless/vterm"
 *
 * const term = createTerminal({ backend: createVtermBackend(), cols: 80, rows: 24 })
 * term.feed("hello")
 * term.screen.getText() // "hello"
 * await term.close()
 * ```
 *
 * Deeper surfaces live at their own arity-scoped subpath: `termless/contract`
 * (the Terminal read contract + region view types), `termless/fmt` (the
 * `.tty` recording format), `termless/rec` (Recording + codecs + replay), and
 * `termless/backends` (the ONLY home of plurality).
 */

export { createTerminal } from "@termless/core"
export type { SpawnOptions, TerminalCreateOptions, TestTerminal, TextMatch } from "@termless/core"

// Mouse input types — TestTerminal's click/dblclick/mouseDown/mouseUp/mouseMove/wheel.
export type { MouseButton, MouseEvent, MouseModifiers, MouseOptions } from "@termless/core"

// Screenshots — SVG (no optional deps) and the PNG auto-picker + explicit renderers.
export { screenshotPng, screenshotSvg, selectRasterizer } from "@termless/core"
export type {
  Rasterizer,
  RasterBitmap,
  RasterRenderer,
  Renderer,
  RendererKind,
  PngScreenshotOptions,
  SvgScreenshotOptions,
  SvgTheme,
  VectorRenderer,
} from "@termless/core"

// Keyboard — string -> descriptor -> ANSI, and the raw escape-sequence scans
// TestTerminal.press()/type() are built from.
export {
  encodeKeyToAnsi,
  keyToAnsi,
  parseKey,
  scanMouseDecset,
  scanMouseDecsetTracking,
  scanWindowOpQueries,
} from "@termless/core"

// Comparison — "did the buffer change", "are two terminal states the same".
export { diffBuffers, diffTerminalStates, terminalStateDigest } from "@termless/core"
export type {
  CellDiff,
  CellSummary,
  DiffResult,
  DigestCursor,
  DigestRow,
  ModeDiff,
  RowDiff,
  TerminalStateDiff,
  TerminalStateDigest,
  TerminalStateDigestOptions,
} from "@termless/core"

// Mock timer — deterministic animation testing.
export { createMockTimer } from "@termless/core"
export type { MockTimerController } from "@termless/core"
