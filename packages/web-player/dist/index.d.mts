import { a as PlaybackEvent, c as PlaybackSink, d as TermlessPlayer, f as TermlessPlayerOptions, i as PlaybackControllerOptions, l as PlaybackState, n as CompiledPlayback, o as PlaybackFormat, r as PlaybackController, s as PlaybackRunOptions, t as CompilePlaybackOptions, u as PlaybackStatus } from "./types-DevCHuwl.mjs";

//#region ../../src/tape/parser.d.ts
/**
 * VHS .tape format parser for termless.
 *
 * Parses the line-based VHS tape format into structured TapeCommand objects.
 * The format is documented at https://github.com/charmbracelet/vhs
 *
 * @example
 * ```ts
 * import { parseTape } from "@termless/core"
 *
 * const tape = parseTape(`
 *   Output demo.gif
 *   Set FontSize 14
 *   Type "hello world"
 *   Enter
 *   Sleep 2s
 *   Screenshot
 * `)
 * ```
 */
type TapeCommand = {
  type: "output";
  path: string;
} | {
  type: "set";
  key: string;
  value: string;
} | {
  type: "type";
  text: string;
  speed?: number;
} | {
  type: "key";
  key: string;
  count?: number;
} | {
  type: "ctrl";
  key: string;
} | {
  type: "alt";
  key: string;
} | {
  type: "sleep";
  ms: number;
} | {
  type: "screenshot";
  path?: string;
} | {
  type: "expect";
  text: string;
  timeout?: number;
} | {
  type: "hide";
} | {
  type: "show";
} | {
  type: "source";
  path: string;
} | {
  type: "require";
  program: string;
};
interface TapeFile {
  commands: TapeCommand[];
  settings: Record<string, string>;
}
//#endregion
//#region src/compile.d.ts
declare function compilePlaybackSource(source: string, options?: CompilePlaybackOptions): CompiledPlayback;
declare function compileAsciicastSource(source: string, options?: CompilePlaybackOptions): CompiledPlayback;
declare function compileTapeSource(source: string, options?: CompilePlaybackOptions): CompiledPlayback;
declare function compileTape(tape: TapeFile, options?: CompilePlaybackOptions): CompiledPlayback;
//#endregion
//#region src/controller.d.ts
declare function createPlaybackController(playback: CompiledPlayback, sink: PlaybackSink, options?: PlaybackControllerOptions): PlaybackController;
//#endregion
export { type CompilePlaybackOptions, type CompiledPlayback, type PlaybackController, type PlaybackControllerOptions, type PlaybackEvent, type PlaybackFormat, type PlaybackRunOptions, type PlaybackSink, type PlaybackState, type PlaybackStatus, type TermlessPlayer, type TermlessPlayerOptions, compileAsciicastSource, compilePlaybackSource, compileTape, compileTapeSource, createPlaybackController };
//# sourceMappingURL=index.d.mts.map