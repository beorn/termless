import { r as compilePlaybackSource, t as createPlaybackController } from "./controller-CP-4k6QC.mjs";
//#region src/player.ts
function createPlayerFactory(loadTerminal) {
	return function createTermlessPlayer(element, source, options = {}) {
		const playback = typeof source === "string" ? compilePlaybackSource(source, options) : source;
		const providedTerminal = options.terminal;
		const terminal = providedTerminal ?? new (loadTerminal())({
			cols: playback.cols,
			rows: playback.rows,
			convertEol: true,
			...options.xtermOptions
		});
		if (!providedTerminal) terminal.open(element);
		const controller = createPlaybackController(playback, {
			reset: () => terminal.reset(),
			resize: (cols, rows) => terminal.resize(cols, rows),
			write: (data) => terminal.write(data)
		}, options);
		const dispose = () => {
			controller.dispose();
			if (!providedTerminal) terminal.dispose();
		};
		const player = {
			...controller,
			dispose,
			terminal,
			playback
		};
		if (options.autoplay ?? false) player.play();
		return player;
	};
}
//#endregion
export { createPlayerFactory as t };

//# sourceMappingURL=player-BYFGG-d9.mjs.map