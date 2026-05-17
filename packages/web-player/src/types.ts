import type { ITerminalOptions, Terminal } from "@xterm/xterm"

export type PlaybackFormat = "asciicast" | "tape"

export type PlaybackEvent =
  | { at: number; type: "resize"; cols: number; rows: number }
  | { at: number; type: "output"; data: string }
  | { at: number; type: "input"; data: string; visible: boolean }
  | { at: number; type: "marker"; label: string }
  | { at: number; type: "visibility"; visible: boolean }

export interface CompiledPlayback {
  format: PlaybackFormat
  cols: number
  rows: number
  durationMs: number
  events: PlaybackEvent[]
  warnings: string[]
  title?: string
}

export interface CompilePlaybackOptions {
  filename?: string
  cols?: number
  rows?: number
  defaultTypingSpeed?: number
  keyDelay?: number
  echoTapeInput?: boolean
  showAsciicastInput?: boolean
}

export interface PlaybackSink {
  reset?: () => void | Promise<void>
  resize?: (cols: number, rows: number) => void | Promise<void>
  write: (data: string) => void | Promise<void>
}

export type PlaybackStatus = "idle" | "playing" | "paused" | "stopped" | "ended"

export interface PlaybackState {
  status: PlaybackStatus
  currentTimeMs: number
  durationMs: number
}

export interface PlaybackRunOptions {
  speed?: number
  startAtMs?: number
  reset?: boolean
}

export interface PlaybackControllerOptions {
  onEvent?: (event: PlaybackEvent) => void
  onInput?: (event: Extract<PlaybackEvent, { type: "input" }>) => void
  onMarker?: (event: Extract<PlaybackEvent, { type: "marker" }>) => void
}

export interface PlaybackController {
  play: (options?: PlaybackRunOptions) => Promise<void>
  pause: () => void
  resume: () => void
  stop: () => void
  seek: (timeMs: number) => Promise<void>
  state: () => PlaybackState
  dispose: () => void
}

export interface TermlessPlayerOptions extends CompilePlaybackOptions, PlaybackControllerOptions {
  autoplay?: boolean
  terminal?: Terminal
  xtermOptions?: ITerminalOptions
}

export interface TermlessPlayer extends PlaybackController {
  terminal: Terminal
  playback: CompiledPlayback
}
