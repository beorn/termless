// ═══════════════════════════════════════════════════════
// Core Types
// ═══════════════════════════════════════════════════════

export interface TerminalOptions {
  cols: number
  rows: number
  scrollbackLimit?: number
}

// ── Cell ──

export interface Cell {
  text: string
  fg: RGB | null
  bg: RGB | null
  bold: boolean
  faint: boolean
  italic: boolean
  underline: UnderlineStyle
  strikethrough: boolean
  inverse: boolean
  wide: boolean
}

export type UnderlineStyle = "none" | "single" | "double" | "curly" | "dotted" | "dashed"

export type RGB = { r: number; g: number; b: number }

// ── Cursor ──

export interface CursorState {
  x: number
  y: number
  visible: boolean
  style: CursorStyle
}

export type CursorStyle = "block" | "underline" | "beam"

// ── Modes ──

export type TerminalMode =
  | "altScreen"
  | "cursorVisible"
  | "bracketedPaste"
  | "applicationCursor"
  | "applicationKeypad"
  | "autoWrap"
  | "mouseTracking"
  | "focusTracking"
  | "originMode"
  | "insertMode"
  | "reverseVideo"

// ── Scrollback ──

export interface ScrollbackState {
  viewportOffset: number
  totalLines: number
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
// TerminalReadable — shared protocol for matchers
// ═══════════════════════════════════════════════════════

export interface TerminalReadable {
  getText(): string
  getTextRange(startRow: number, startCol: number, endRow: number, endCol: number): string
  getCell(row: number, col: number): Cell
  getLine(row: number): Cell[]
  getLines(): Cell[][]
  getCursor(): CursorState
  getMode(mode: TerminalMode): boolean
  getTitle(): string
  getScrollback(): ScrollbackState
}

// ═══════════════════════════════════════════════════════
// TerminalBackend — all backends MUST implement this
// ═══════════════════════════════════════════════════════

export interface TerminalBackend extends TerminalReadable {
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

  // Scrollback
  scrollViewport(delta: number): void

  // Capabilities
  readonly capabilities: TerminalCapabilities
}

// ═══════════════════════════════════════════════════════
// Terminal — high-level API wrapping backend + optional PTY
// ═══════════════════════════════════════════════════════

export interface TerminalCreateOptions {
  backend: TerminalBackend
  cols?: number
  rows?: number
  scrollbackLimit?: number
}

export interface SpawnOptions {
  command: string[]
  env?: Record<string, string>
  cwd?: string
}

export interface TextPosition {
  row: number
  col: number
  text: string
}

export interface Terminal extends TerminalReadable {
  readonly cols: number
  readonly rows: number
  readonly backend: TerminalBackend

  // Direct data feed (no PTY)
  feed(data: Uint8Array | string): void

  // PTY lifecycle
  spawn(command: string[], options?: Omit<SpawnOptions, "command">): Promise<void>
  readonly alive: boolean
  readonly exitInfo: string | null

  // Input
  press(key: string): void
  type(text: string): void

  // Waiting
  waitFor(text: string, timeout?: number): Promise<void>
  waitForStable(stableMs?: number, timeout?: number): Promise<void>

  // Search
  find(text: string): TextPosition | null
  findAll(pattern: RegExp): TextPosition[]

  // Screenshot
  screenshotSvg(options?: SvgScreenshotOptions): string

  // Resize
  resize(cols: number, rows: number): void

  // Cleanup
  close(): Promise<void>
  [Symbol.asyncDispose](): Promise<void>
}

// ═══════════════════════════════════════════════════════
// SVG Screenshot Options
// ═══════════════════════════════════════════════════════

export interface SvgScreenshotOptions {
  fontFamily?: string
  fontSize?: number
  cellWidth?: number
  cellHeight?: number
  theme?: SvgTheme
}

export interface SvgTheme {
  foreground?: string
  background?: string
  cursor?: string
  palette?: Record<number, string>
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
  setColorPalette(entries: Partial<Record<number, RGB>>): void
  setDefaultFg(color: RGB): void
  setDefaultBg(color: RGB): void
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
