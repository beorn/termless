import type { Cell, Color, Cursor, Mode } from "../io/picture.ts"
import type { SpawnOptions as IoSpawnOptions } from "../io/session.ts"

// ═══════════════════════════════════════════════════════
// Core Types
// ═══════════════════════════════════════════════════════

export interface TerminalOptions {
  cols: number
  rows: number
  scrollbackLimit?: number
}

// ── The readable picture — declared in io, re-exported here ──
//
// `Cell`, `Color`, `UnderlineStyle`, `Cursor` and `CursorStyle` are the shapes
// an Emulator exposes, so they are declared in `src/io/picture.ts` (which
// depends on nothing) and re-exported here. There is exactly one declaration of
// each in the package; every existing import path keeps working.

export type { Cell, Color, Cursor, CursorStyle, UnderlineStyle } from "../io/picture.ts"

// ── Modes ──

/**
 * @deprecated REMOVING in unterm phase A4 — renamed to `Mode`
 * (`@termless/core/io`). A true alias: same union, full-word member names
 * unchanged.
 */
export type TerminalMode = Mode

// ── Scrollback ──

export interface ScrollbackState {
  /**
   * Absolute row index of the row where the viewport region starts in the buffer.
   * When at the bottom (no scrollback visible): `totalRows - screenRows`.
   * When scrolled to the very top: `0`.
   *
   * Used by region views as the start row for viewport rendering:
   * `createRegion(readable, viewportTop, viewportTop + screenRows)`.
   */
  viewportTop: number
  /**
   * Total number of rows in the buffer (scrollback history + screen).
   * Row 0 is the first row in scrollback; row `totalRows - 1` is the last screen row.
   */
  totalRows: number
  /**
   * Number of visible screen rows (the terminal's row dimension).
   * The screen occupies the last `screenRows` rows of the buffer
   * (rows `totalRows - screenRows` through `totalRows - 1`).
   */
  screenRows: number
  /** @deprecated REMOVING in unterm phase A4 — renamed to {@link ScrollbackState.viewportTop}. Kept required during the migration window. */
  viewportOffset: number
  /** @deprecated REMOVING in unterm phase A4 — renamed to {@link ScrollbackState.totalRows}. Kept required during the migration window. */
  totalLines: number
  /** @deprecated REMOVING in unterm phase A4 — renamed to {@link ScrollbackState.screenRows}. Kept required during the migration window. */
  screenLines: number
}

// ── Key ──

export interface KeyDescriptor {
  key: string
  shift?: boolean
  ctrl?: boolean
  alt?: boolean
  super?: boolean
}

// ── Capabilities ──

export interface TerminalCapabilities {
  name: string
  version: string
  truecolor: boolean
  kittyKeyboard: boolean
  kittyGraphics: boolean
  sixel: boolean
  osc8Hyperlinks: boolean
  semanticPrompts: boolean
  unicode: string
  reflow: boolean
  extensions: Set<string>
}

// ═══════════════════════════════════════════════════════
// View Types — composable regions for matchers
// ═══════════════════════════════════════════════════════

/** A region of the terminal that can produce text. Used with text matchers. */
export interface Region {
  getText(): string
  getLines(): string[]
  containsText(text: string): boolean
}

/**
 * Raw terminal output stream captured before emulator parsing.
 *
 * Use this for terminal protocol assertions (OSC/APC/CSI bytes such as
 * Kitty graphics packets) that may intentionally leave no visible cells.
 */
export interface RawOutput {
  getText(): string
  /**
   * @deprecated REMOVING in unterm phase A4 — a chunk row is an `output`
   * Event. Read `session.output` (or filter `session.events()` on
   * `type === "output"`) from `@termless/core/io`. Not a true alias: a chunk is
   * a bare decoded string, an `OutputEvent` is `{at, type, data}` with the
   * timestamp and the byte payload the chunk list throws away.
   */
  getChunks(): readonly string[]
  containsOutput(text: string): boolean
  clear(): void
}

/**
 * A positioned cell — a {@link Cell} plus the `row`/`col` where it lives.
 *
 * @deprecated REMOVING in unterm phase A4 — the `CellView` concept is folded into {@link Cell}: positioned
 * accessors (`cell(row, col)`, `cellAt(col)`) return `Cell`, and where a caller
 * needs the position it is supplied by the query (the accessor arguments, or a
 * {@link TextMatch}). This alias remains for the migration window; the extra
 * `row`/`col` are still populated by `cell()`/`cellAt()` for back-compat.
 */
export type CellView = Cell & {
  readonly row: number
  readonly col: number
}

/** A row is a {@link Region} with positional context and cell access. */
export interface Row extends Region {
  readonly row: number
  readonly cells: Cell[]
  cellAt(col: number): Cell
}

// ═══════════════════════════════════════════════════════
// Terminal — shared read contract for backends (THE contract)
// ═══════════════════════════════════════════════════════

/**
 * Shared read contract for terminal backends — THE terminal contract. The
 * engine implements it; consumer signatures read `fn(term: Terminal)`.
 *
 * **Row vs line**: a *row* is a line of cells (`getRow`/`getRows`); a *line* is
 * a line of text ({@link Region.getText}/{@link Region.getLines}).
 *
 * **Coordinate system**: All row parameters use **absolute buffer rows**.
 * Row 0 is the first row in scrollback history. The screen occupies the
 * last `screenRows` rows (from `totalRows - screenRows` to `totalRows - 1`).
 *
 * @deprecated REMOVING in unterm phase A4 — the read half of `Emulator`
 * (`@termless/core/io`), where the readable picture lives on the emulator
 * itself. Not a true alias: `Emulator` spells the cursor, modes and size as
 * properties (`cursor`, `modes`, `size`) rather than accessors
 * (`getCursor()`, `getMode(m)`, `getScrollback()`). Adapt with
 * `emulatorFromBackend()` in `terminal/io-compat.ts`.
 */
export interface Terminal {
  /** Get all buffer text (scrollback + screen) as a newline-joined string. */
  getText(): string
  /**
   * Get text in a rectangular range using absolute buffer rows.
   * startCol/endCol apply to the first/last rows respectively;
   * intermediate rows return full width.
   */
  getTextRange(startRow: number, startCol: number, endRow: number, endCol: number): string
  /** Get a single cell at an absolute buffer row and column. */
  getCell(row: number, col: number): Cell
  /** Get all cells in an absolute buffer row. */
  getRow(row: number): Cell[]
  /** Get every row as a cell array (entire buffer: scrollback + screen). */
  getRows(): Cell[][]
  /** @deprecated REMOVING in unterm phase A4 — renamed to {@link Terminal.getRow} (row = cells). Kept required during the migration window. */
  getLine(row: number): Cell[]
  /** @deprecated REMOVING in unterm phase A4 — renamed to {@link Terminal.getRows} (row = cells). Kept required during the migration window. */
  getLines(): Cell[][]
  getCursor(): Cursor
  getMode(mode: TerminalMode): boolean
  getTitle(): string
  getScrollback(): ScrollbackState
}

// ═══════════════════════════════════════════════════════
// TerminalBackend — all backends MUST implement this
// ═══════════════════════════════════════════════════════

/**
 * Options accepted by {@link TerminalBackend.screenshot} and
 * {@link TestTerminal.screenshot}.
 *
 * Mirrors `@termless/ghostty`'s `RenderOptions` shape — kept as a local minimal
 * type here so `@termless/core` does not import from `@termless/ghostty` (which
 * would create a peer-dep cycle: ghostty already depends on core). The two
 * shapes are kept structurally compatible by hand.
 *
 * Fields are documented in `@termless/ghostty`'s `RenderOptions`.
 */
export interface ScreenshotOptions {
  cols?: number
  rows?: number
  fontSize?: number
  fontFamily?: string
  fontPath?: string
  dpr?: number
  cursorStyle?: "block" | "underline" | "beam"
  cursorBlink?: boolean
  hideCursor?: boolean
  cellWidth?: number
  cellHeight?: number
  targetWidth?: number
  targetHeight?: number
  theme?: Record<string, string>
  /**
   * Which renderer rasterizes the screenshot — `canvas` (`@napi-rs/canvas`,
   * high fidelity), `resvg` (`@resvg/resvg-js`, cross-platform), `swash`
   * (`@termless/swash-render`, pure-Rust, browser-grade color emoji),
   * `browser` (headless Chromium via the optional `playwright` package —
   * absolute-max fidelity, opt-in only), or `auto` (canvas when its native
   * binding loads, else resvg). Default `auto`. A *force* override consulted
   * by {@link TestTerminal.screenshot}. `browser` is never reached from `auto`.
   */
  renderer?: "canvas" | "resvg" | "swash" | "browser" | "auto"
}

/**
 * Every backend implements this: the {@link Terminal} read contract plus
 * lifecycle, the byte feed, resize, key encoding and capabilities.
 *
 * @deprecated REMOVING in unterm phase A4 — replaced by `Emulator`
 * (`@termless/core/io`), which collapses `feed`/`resize`/`reset` into a single
 * `apply(event)` door. Not a true alias: `Emulator` has no `init`/`destroy`
 * lifecycle, no `encodeKey`, and no `capabilities` — those either move to the
 * factory that builds the emulator or to the parts around it. Adapt an
 * existing backend with `emulatorFromBackend()` in `terminal/io-compat.ts`.
 */
export interface TerminalBackend extends Terminal {
  readonly name: string

  // Lifecycle
  init(opts: TerminalOptions): void
  destroy(): void

  // Data flow
  feed(data: Uint8Array): void
  resize(cols: number, rows: number): void
  reset(): void

  // Key encoding
  encodeKey(key: KeyDescriptor): Uint8Array

  /**
   * Callback invoked when the emulator generates a response that must be
   * written back to the PTY (e.g., cursor position reports, device attribute
   * responses, kitty keyboard negotiation). Set by the Terminal layer when
   * a PTY is spawned.
   */
  onResponse?: (data: Uint8Array) => void

  // Scrollback
  scrollViewport(delta: number): void

  // Capabilities
  readonly capabilities: TerminalCapabilities

  /**
   * Optional native screenshot capability. Present iff the backend has its
   * own raster renderer (today: only the ghostty backend, which renders via
   * `@termless/ghostty.renderTerminalPng`).
   *
   * Parser-only backends (xtermjs / vt100 / vterm / libvterm / alacritty /
   * wezterm) do NOT implement this; `Terminal.screenshot()` proxies them
   * through `@termless/ghostty`'s renderer by re-emitting cells as ANSI via
   * `cellsToAnsi` + `renderAnsiPng`.
   */
  screenshot?(opts?: ScreenshotOptions): Promise<Uint8Array>
}

// ═══════════════════════════════════════════════════════
// Terminal — high-level API wrapping backend + optional PTY
// ═══════════════════════════════════════════════════════

export interface TerminalCreateOptions {
  backend: TerminalBackend
  cols?: number
  rows?: number
  scrollbackLimit?: number
  /**
   * Optional hook fired after every successful write to the backend
   * (both direct `feed()` calls and PTY-spawned data). Receives the raw
   * bytes written. Used by frame-trace mode and other observers that need
   * to react to buffer mutations without polling.
   */
  onAfterWrite?: (data: Uint8Array) => void
}

/**
 * What `TestTerminal.spawn()` needs to start a program — the size comes from
 * the terminal it is spawned into, so it is the io `SpawnOptions` minus
 * `size`.
 *
 * @deprecated REMOVING in unterm phase A4 — use `SpawnOptions` from
 * `@termless/core/io` and pass `size` explicitly. A true alias: the shape is
 * derived from the io type, not restated.
 */
export type SpawnOptions = Omit<IoSpawnOptions, "size">

/**
 * A text search match: the matched `text`, its `row`/`col` in the buffer, and
 * the underlying `cells` so a match chains into style assertions.
 */
export interface TextMatch {
  text: string
  row: number
  col: number
  cells: Cell[]
}

/** Modifier keys for mouse events. */
export interface MouseModifiers {
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
}

/** Named mouse button. */
export type MouseButton = "left" | "middle" | "right"

/** Options for mouse click/press/release events. */
export interface MouseOptions extends MouseModifiers {
  /**
   * Mouse button — default `"left"`. The numeric spellings `0`/`1`/`2`
   * (left/middle/right) are **deprecated** but still accepted and normalized.
   */
  button?: MouseButton | 0 | 1 | 2
}

/**
 * High-level test terminal — the harness. Wraps a {@link TerminalBackend} and
 * an optional PTY, and adds region selectors, search, mouse input, waiting, and
 * screenshots on top of the {@link Terminal} read contract.
 */
export interface TestTerminal extends Terminal {
  readonly cols: number
  readonly rows: number
  readonly backend: TerminalBackend

  // Region selectors (WHERE)
  readonly screen: Region
  readonly scrollback: Region
  readonly buffer: Region
  readonly viewport: Region
  readonly output: RawOutput
  /** @deprecated REMOVING in unterm phase A4 — renamed to {@link TestTerminal.output}. */
  readonly out: RawOutput
  row(n: number): Row
  cell(row: number, col: number): Cell
  range(r1: number, c1: number, r2: number, c2: number): Region
  firstRow(): Row
  lastRow(): Row

  // Direct data feed (no PTY)
  feed(data: Uint8Array | string): void

  // PTY lifecycle
  spawn(command: string[], options?: Omit<SpawnOptions, "command">): Promise<void>
  readonly alive: boolean
  readonly exitInfo: string | null

  // Input — keyboard
  press(key: string): void
  type(text: string): void

  // Input — mouse (SGR mode 1006)
  click(x: number, y: number, options?: MouseOptions): void
  dblclick(x: number, y: number, options?: MouseOptions & { delay?: number }): Promise<void>
  mouseDown(x: number, y: number, options?: MouseOptions): void
  mouseUp(x: number, y: number, options?: MouseOptions): void
  mouseMove(x: number, y: number, options?: MouseOptions): void
  wheel(deltaX: number, deltaY: number, options?: { x?: number; y?: number } & MouseModifiers): void

  // Waiting
  waitFor(text: string, timeout?: number): Promise<void>
  waitForStable(stableMs?: number, timeout?: number): Promise<void>

  // Search
  findText(text: string): TextMatch | null
  findAllText(pattern: RegExp): TextMatch[]
  /** @deprecated REMOVING in unterm phase A4 — renamed to {@link TestTerminal.findText}. */
  find(text: string): TextMatch | null
  /** @deprecated REMOVING in unterm phase A4 — renamed to {@link TestTerminal.findAllText}. */
  findAll(pattern: RegExp): TextMatch[]

  // Screenshot
  screenshotSvg(options?: SvgScreenshotOptions): string
  screenshotPng(options?: PngScreenshotOptions): Promise<Uint8Array>
  /**
   * Auto-picking PNG screenshot.
   *
   * Decision tree:
   *   1. If the backend implements `screenshot()` natively (today: ghostty),
   *      use it directly.
   *   2. Otherwise, try the `@termless/ghostty` proxy path: serialize the
   *      backend's cell grid via `cellsToAnsi`, feed to `renderAnsiPng`.
   *   3. If `@termless/ghostty` is not installed, fall back to the resvg-based
   *      SVG → PNG path (`screenshotPng`). Cross-platform safe; lower fidelity.
   */
  screenshot(options?: ScreenshotOptions): Promise<Uint8Array>
  /**
   * Explicit native-canvas PNG screenshot. Always goes through `@termless/ghostty`'s
   * `renderAnsiPng` regardless of whether the backend has a native `screenshot()`
   * method — useful when the caller wants the ghostty renderer's fidelity
   * specifically (consistent fonts/theme/metrics) and doesn't want the
   * auto-picker silently using a different path.
   *
   * Throws if `@termless/ghostty` is not installed.
   */
  screenshotCanvasPng(options?: ScreenshotOptions): Promise<Uint8Array>

  // Resize
  resize(cols: number, rows: number): void

  // Clipboard
  /** Captured OSC 52 clipboard writes (decoded text). Populated when terminal output contains OSC 52 set-clipboard sequences. */
  readonly clipboardWrites: string[]

  // Cleanup
  close(): Promise<void>
  [Symbol.asyncDispose](): Promise<void>
}

// ═══════════════════════════════════════════════════════
// SVG Screenshot Options
// ═══════════════════════════════════════════════════════

/**
 * Window bar style on a rendered screenshot.
 *
 * - `none` — no bar.
 * - `colorful` — macOS traffic-light dots, filled (active window).
 * - `rings` — macOS traffic-light dots, outlined (inactive window).
 * - `windows` — a flat Windows-style title bar with minimize / maximize /
 *   close glyphs at the right edge.
 */
export type WindowBar = "none" | "rings" | "colorful" | "windows"

export interface SvgScreenshotOptions {
  fontFamily?: string
  fontSize?: number
  cellWidth?: number
  cellHeight?: number
  theme?: SvgTheme
  /** Padding between terminal content and SVG edge in pixels (default: 0). */
  padding?: number
  /** Border radius for the outer SVG rect in pixels (default: 0). */
  borderRadius?: number
  /** Window bar style — macOS traffic light dots (default: "none"). */
  windowBar?: WindowBar
  /** Height of the window bar area in pixels (default: 40). */
  windowBarSize?: number
  /** Optional title text rendered centered in the window bar. */
  windowTitle?: string
  /**
   * Soft drop shadow blur radius in pixels for the window frame (default: 0
   * — no shadow). Needs a `margin` large enough to contain the blur, else the
   * shadow is clipped at the SVG edge.
   */
  shadow?: number
  /** Outer margin around the SVG in pixels (default: 0). */
  margin?: number
  /** Fill color for the outer margin area (default: transparent). */
  marginFill?: string
  /** Playback speed multiplier for Sleep durations (default: 1). */
  playbackSpeed?: number
  /** Output framerate in frames per second (default: 50). */
  framerate?: number
  /**
   * Embed the bundled fonts into the SVG as base64 `@font-face` rules, and
   * point `font-family` at them (default: false). A self-contained SVG renders
   * identically everywhere — no host-font dependency. Use for standalone
   * `.svg` output; leave off for the GIF pipeline (the rasterizer supplies
   * fonts, and per-frame embedding would bloat the in-memory frame set).
   */
  embedFonts?: boolean
}

export interface PngScreenshotOptions extends SvgScreenshotOptions {
  /** Render scale factor (default: 2 for retina-quality output). */
  scale?: number
}

export interface SvgTheme {
  foreground?: string
  background?: string
  cursor?: string
  palette?: Record<number, string>
}

// ═══════════════════════════════════════════════════════
// Emulator Warnings
// ═══════════════════════════════════════════════════════

/**
 * Structured warning emitted by a terminal emulator backend.
 *
 * Backends capture these instead of (or in addition to) using console.log/warn.
 * Test infrastructure checks for unexpected warnings after each test to surface
 * portability issues — e.g., an emulator saying "unsupported OSC: 66" is the
 * emulator telling you "your portability assumption is false."
 */
export interface EmulatorWarning {
  /** Warning category code, e.g., "UNSUPPORTED_OSC", "UNKNOWN_CSI", "PARSE_ERROR" */
  code: string
  /** The raw message from the emulator */
  message: string
  /** Which backend produced this warning */
  backend: string
}

/**
 * Extension interface for backends that can capture emulator warnings.
 *
 * Backends implementing this collect warnings during feed() calls instead of
 * logging to console. Test infrastructure drains warnings after each test.
 */
export interface WarningExtension {
  /** Get all accumulated warnings since last drain. */
  getWarnings(): EmulatorWarning[]
  /** Clear accumulated warnings (called by test teardown). */
  clearWarnings(): void
}

// ═══════════════════════════════════════════════════════
// Extension Interfaces (optional)
// ═══════════════════════════════════════════════════════

export interface MouseEvent {
  x: number
  y: number
  button: "left" | "middle" | "right" | "wheelUp" | "wheelDown" | "none"
  action: "press" | "release" | "move"
  shift?: boolean
  ctrl?: boolean
  alt?: boolean
}

export interface MouseEncodingExtension {
  encodeMouse(event: MouseEvent): Uint8Array | null
}

export interface ColorPaletteExtension {
  setColorPalette(entries: Partial<Record<number, Color>>): void
  setDefaultFg(color: Color): void
  setDefaultBg(color: Color): void
}

export interface DirtyTrackingExtension {
  getDirtyRows(): Set<number>
  clearDirty(): void
}

export interface HyperlinkExtension {
  getHyperlinkAt(row: number, col: number): string | null
}

export interface BellExtension {
  getBellCount(): number
  clearBellCount(): void
}

export function hasExtension<T>(backend: TerminalBackend, ext: string): backend is TerminalBackend & T {
  return backend.capabilities.extensions.has(ext)
}
