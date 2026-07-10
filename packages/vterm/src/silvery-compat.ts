/**
 * Structural Silvery island/viewport types used by the vterm guest bridge.
 *
 * Termless must typecheck as a standalone package from npm. The km monorepo
 * has newer internal `@silvery/ag/*` source paths, but those subpath exports
 * are not a stable published dependency surface yet. Keep the narrow contract
 * local and structural; Silvery consumes these shapes by duck typing.
 *
 * This is the SAME structural contract `@termless/xtermjs` mirrors — the two
 * guests are drop-in compatible by shape, not by shared import, so a host can
 * inject either behind the deck's ShellGuest seam.
 */

export interface CellAttrs {
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  underlineStyle?: "single" | "double" | "curly" | "dotted" | "dashed"
  inverse?: boolean
  strikethrough?: boolean
}

export interface Cell {
  char: string
  fg: string | null
  bg: string | null
  attrs: CellAttrs
  wide: boolean
  continuation: boolean
}

export interface CellBuffer {
  readonly cols: number
  readonly rows: number
  getCell(col: number, row: number): Cell
}

export interface ViewportRect {
  readonly row: number
  readonly col: number
  readonly width: number
  readonly height: number
}

export type ViewportInputMode = "none" | "keys" | "mouse" | "all"
export type ViewportCursorStyle = "block" | "underline" | "bar"

export interface ViewportContext {
  dimensions(): { cols: number; rows: number }
  blit(dirtyRects: readonly ViewportRect[], buffer: CellBuffer): void
  setCursor(pos: { row: number; col: number }, style?: ViewportCursorStyle): void
  invalidateAll(): void
  requestInputMode(mode: ViewportInputMode): void
  emitTitle?(title: string): void
}

export interface ForeignSource {
  connect(ctx: ViewportContext): void
  disconnect(): void
  desiredSize?(): { cols: number; rows: number }
}

export interface IslandCapabilities {
  input?: boolean
  modes?: boolean
  resize?: boolean
  palette?: boolean
}

export interface IslandProtocolModes {
  altScreen?: boolean
  bracketedPaste?: boolean
  mouseTracking?: "off" | "click" | "drag" | "any"
  kittyKeyboard?: boolean
  focusReporting?: boolean
  cursor?: { shape: "block" | "underline" | "bar"; visible: boolean }
}

export type IslandSignal =
  | { type: "ready" }
  | { type: "exit"; code?: number; reason?: string }
  | { type: "error"; error: Error }

export interface IslandContext {
  readonly cols: number
  readonly rows: number
  emit(signal: IslandSignal): void
  requestResize(cols: number, rows: number): void
  execOSC(command: string): Promise<string | void>
  readonly abortSignal: AbortSignal
  now(): number
}

export interface IslandKeyEvent {
  input: string
  name?: string
  ctrl?: boolean
  meta?: boolean
  alt?: boolean
  shift?: boolean
  super?: boolean
  eventType?: "press" | "repeat"
}

export interface IslandMouseEvent {
  row: number
  col: number
  button: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
}

export type IslandInputEvent =
  | (IslandKeyEvent & { kind: "key" })
  | (IslandMouseEvent & { kind: "mouse" })
  | { kind: "paste"; text: string }
  | { kind: "feed"; bytes: Uint8Array }

export interface IslandSizeOwner {
  readonly cols: number
  readonly rows: number
  subscribe(listener: (size: { cols: number; rows: number }) => void): () => void
  requestResize(cols: number, rows: number): void
}

export interface IslandOutputOwner {
  readonly buffer: CellBuffer
  readonly cursor: { row: number; col: number; style: ViewportCursorStyle } | null
  readonly cursorVisible: boolean
  subscribe(listener: () => void): () => void
  writeCells(dirtyRects: readonly ViewportRect[], buffer: CellBuffer): void
  invalidateAll(): void
}

export interface IslandInputOwner {
  onKey?(handler: (event: IslandKeyEvent) => void): () => void
  onMouse?(handler: (event: IslandMouseEvent) => void): () => void
  onPaste?(handler: (text: string) => void): () => void
  feed?(bytes: Uint8Array): void
  events?(): AsyncIterable<IslandInputEvent>
  sendEof?(): void
}

export interface IslandModesOwner {
  readonly modes: IslandProtocolModes
  subscribe(listener: (modes: IslandProtocolModes) => void): () => void
}

export interface IslandSignalsOwner {
  sendSigint(): void
  sendSigtstp(): void
  sendSigterm(): void
  sendSigkill(): void
  readonly exit: Promise<{ code?: number; reason?: string }>
}

export interface IslandHandle {
  readonly size: IslandSizeOwner
  readonly output: IslandOutputOwner
  readonly input?: IslandInputOwner
  readonly modes?: IslandModesOwner
  readonly signals?: IslandSignalsOwner
  dispose(): void | Promise<void>
}

export interface IslandGuest {
  init(ctx: IslandContext): Promise<IslandHandle>
  capabilities?: IslandCapabilities
}
