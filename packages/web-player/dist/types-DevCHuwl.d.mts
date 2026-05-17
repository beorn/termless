import { ITerminalOptions, Terminal } from "@xterm/xterm";

//#region src/types.d.ts
type PlaybackFormat = "asciicast" | "tape";
type PlaybackEvent = {
  at: number;
  type: "resize";
  cols: number;
  rows: number;
} | {
  at: number;
  type: "output";
  data: string;
} | {
  at: number;
  type: "input";
  data: string;
  visible: boolean;
} | {
  at: number;
  type: "marker";
  label: string;
} | {
  at: number;
  type: "visibility";
  visible: boolean;
};
interface CompiledPlayback {
  format: PlaybackFormat;
  cols: number;
  rows: number;
  durationMs: number;
  events: PlaybackEvent[];
  warnings: string[];
  title?: string;
}
interface CompilePlaybackOptions {
  filename?: string;
  cols?: number;
  rows?: number;
  defaultTypingSpeed?: number;
  keyDelay?: number;
  echoTapeInput?: boolean;
  showAsciicastInput?: boolean;
}
interface PlaybackSink {
  reset?: () => void | Promise<void>;
  resize?: (cols: number, rows: number) => void | Promise<void>;
  write: (data: string) => void | Promise<void>;
}
type PlaybackStatus = "idle" | "playing" | "paused" | "stopped" | "ended";
interface PlaybackState {
  status: PlaybackStatus;
  currentTimeMs: number;
  durationMs: number;
}
interface PlaybackRunOptions {
  speed?: number;
  startAtMs?: number;
  reset?: boolean;
}
interface PlaybackControllerOptions {
  onEvent?: (event: PlaybackEvent) => void;
  onInput?: (event: Extract<PlaybackEvent, {
    type: "input";
  }>) => void;
  onMarker?: (event: Extract<PlaybackEvent, {
    type: "marker";
  }>) => void;
}
interface PlaybackController {
  play: (options?: PlaybackRunOptions) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  seek: (timeMs: number) => Promise<void>;
  state: () => PlaybackState;
  dispose: () => void;
}
interface TermlessPlayerOptions extends CompilePlaybackOptions, PlaybackControllerOptions {
  autoplay?: boolean;
  terminal?: Terminal;
  xtermOptions?: ITerminalOptions;
}
interface TermlessPlayer extends PlaybackController {
  terminal: Terminal;
  playback: CompiledPlayback;
}
//#endregion
export { PlaybackEvent as a, PlaybackSink as c, TermlessPlayer as d, TermlessPlayerOptions as f, PlaybackControllerOptions as i, PlaybackState as l, CompiledPlayback as n, PlaybackFormat as o, PlaybackController as r, PlaybackRunOptions as s, CompilePlaybackOptions as t, PlaybackStatus as u };
//# sourceMappingURL=types-DevCHuwl.d.mts.map