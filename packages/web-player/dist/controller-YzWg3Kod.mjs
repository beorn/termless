//#region ../../src/key-mapping.ts
const KEY_MAP = {
	ArrowUp: "\x1B[A",
	ArrowDown: "\x1B[B",
	ArrowLeft: "\x1B[D",
	ArrowRight: "\x1B[C",
	Home: "\x1B[H",
	End: "\x1B[F",
	PageUp: "\x1B[5~",
	PageDown: "\x1B[6~",
	Enter: "\r",
	Tab: "	",
	Backspace: "",
	Delete: "\x1B[3~",
	Escape: "\x1B",
	Space: " ",
	Control: null,
	Shift: null,
	Alt: null,
	Meta: null
};
const FKEY_MAP = {
	F1: "\x1BOP",
	F2: "\x1BOQ",
	F3: "\x1BOR",
	F4: "\x1BOS",
	F5: "\x1B[15~",
	F6: "\x1B[17~",
	F7: "\x1B[18~",
	F8: "\x1B[19~",
	F9: "\x1B[20~",
	F10: "\x1B[21~",
	F11: "\x1B[23~",
	F12: "\x1B[24~"
};
const MODIFIER_ALIASES = {
	ctrl: "ctrl",
	control: "ctrl",
	shift: "shift",
	alt: "alt",
	meta: "super",
	cmd: "super",
	option: "alt",
	super: "super"
};
function normalizeModifier(mod) {
	return MODIFIER_ALIASES[mod.toLowerCase()] ?? mod.toLowerCase();
}
/**
* Parse a key string like "Ctrl+a", "ArrowUp", "Shift+Tab" into a KeyDescriptor.
*
* Supports modifier prefixes: Ctrl, Control, Alt, Shift, Meta, Cmd, Option, Super.
* Modifiers are case-insensitive and separated by "+".
*/
function parseKey(key) {
	const parts = key.split("+");
	const result = { key: parts.pop() };
	for (const part of parts) switch (normalizeModifier(part)) {
		case "ctrl":
			result.ctrl = true;
			break;
		case "shift":
			result.shift = true;
			break;
		case "alt":
			result.alt = true;
			break;
		case "super":
			result.super = true;
			break;
	}
	return result;
}
/**
* Convert a key descriptor or key string to its ANSI escape sequence.
*
* Handles:
* - Single characters: returned as-is
* - Named keys (ArrowUp, Enter, Tab, etc.): mapped to standard ANSI sequences
* - Function keys (F1-F12): mapped to VT220/xterm sequences
* - Ctrl+letter: ASCII control codes 1-26
* - Ctrl+Enter: newline (\n)
* - Alt+key: ESC prefix + key
*/
function keyToAnsi(key) {
	const desc = typeof key === "string" ? parseKey(key) : key;
	const { key: mainKey, ctrl, alt, shift } = desc;
	const hasSuperOrMeta = desc.super;
	if (ctrl && mainKey.length === 1) {
		const code = mainKey.toLowerCase().charCodeAt(0) - 96;
		if (code >= 1 && code <= 26) return String.fromCharCode(code);
	}
	if (ctrl && mainKey === "Enter") return "\n";
	if ((alt || hasSuperOrMeta) && mainKey.length === 1) return `\x1b${mainKey}`;
	const fkey = FKEY_MAP[mainKey];
	if (fkey !== void 0) {
		if (ctrl || alt || shift || hasSuperOrMeta) {
			const mod = 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0) + (hasSuperOrMeta ? 8 : 0);
			const fkeyNum = parseInt(mainKey.slice(1));
			if (fkeyNum <= 4) return `\x1b[${fkeyNum + 10};${mod}~`;
			const match = fkey.match(/\x1b\[(\d+)~/);
			if (match) return `\x1b[${match[1]};${mod}~`;
		}
		return fkey;
	}
	const mapped = KEY_MAP[mainKey];
	if (mapped !== void 0) {
		if (mapped === null) return "";
		if ((ctrl || alt || shift || hasSuperOrMeta) && mapped.startsWith("\x1B[")) {
			const mod = 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0) + (hasSuperOrMeta ? 8 : 0);
			const letterMatch = mapped.match(/\x1b\[([A-H])$/);
			if (letterMatch) return `\x1b[1;${mod}${letterMatch[1]}`;
			const tildeMatch = mapped.match(/\x1b\[(\d+)~$/);
			if (tildeMatch) return `\x1b[${tildeMatch[1]};${mod}~`;
		}
		if (shift && mainKey === "Tab") return "\x1B[Z";
		return mapped;
	}
	if (mainKey.length === 1) {
		if (shift && mainKey.match(/[a-z]/)) return mainKey.toUpperCase();
		return mainKey;
	}
	return mainKey;
}
//#endregion
//#region ../../src/asciicast/reader.ts
/**
* Parse an asciicast v2 file from its string content.
*
* Handles both `\n` and `\r\n` line endings. Validates the header
* version (must be 2) and parses event tuples.
*
* @throws {Error} If the content is empty, the header is missing version 2,
*   or an event line has an invalid format.
*/
function parseAsciicast(content) {
	const lines = content.split("\n").filter((line) => line.trim().length > 0);
	if (lines.length === 0) throw new Error("Empty asciicast file");
	const headerLine = lines[0].replace(/\r$/, "");
	const header = JSON.parse(headerLine);
	if (header.version !== 2) throw new Error(`Unsupported asciicast version: ${header.version} (expected 2)`);
	const events = [];
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i].replace(/\r$/, "");
		const tuple = JSON.parse(line);
		if (!Array.isArray(tuple) || tuple.length < 3) throw new Error(`Invalid event at line ${i + 1}: expected [time, type, data]`);
		const [time, type, data] = tuple;
		events.push({
			time,
			type,
			data
		});
	}
	return {
		header,
		events
	};
}
//#endregion
//#region ../../src/tape/parser.ts
/**
* Parse a duration string into milliseconds.
*
* Supports: "2s" -> 2000, "500ms" -> 500, "0.5s" -> 500, "100" -> 100 (ms).
*/
function parseDuration(s) {
	const trimmed = s.trim();
	if (trimmed.endsWith("ms")) return Number.parseFloat(trimmed.slice(0, -2));
	if (trimmed.endsWith("s")) return Number.parseFloat(trimmed.slice(0, -1)) * 1e3;
	return Number.parseFloat(trimmed);
}
const KEY_COMMANDS = new Set([
	"enter",
	"backspace",
	"tab",
	"space",
	"up",
	"down",
	"left",
	"right",
	"escape",
	"delete",
	"pageup",
	"pagedown",
	"home",
	"end"
]);
/**
* Parse a quoted string, handling escaped quotes.
* Returns the unquoted content.
*/
function parseQuotedString(s) {
	if (s.startsWith("\"") && s.endsWith("\"")) return s.slice(1, -1).replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
	return s;
}
/**
* Parse a single line into a TapeCommand, or null for comments/blank lines.
*/
function parseLine(line) {
	const trimmed = line.trim();
	if (trimmed === "" || trimmed.startsWith("#")) return null;
	const parts = splitCommandLine(trimmed);
	if (parts.length === 0) return null;
	const cmd = parts[0];
	const cmdLower = cmd.toLowerCase();
	if (cmdLower === "output") return {
		type: "output",
		path: parts.slice(1).join(" ")
	};
	if (cmdLower === "set") return {
		type: "set",
		key: parts[1] ?? "",
		value: parseQuotedString(parts.slice(2).join(" "))
	};
	if (cmdLower === "type" || cmdLower.startsWith("type@")) {
		let speed;
		if (cmdLower.startsWith("type@")) speed = parseDuration(cmd.slice(5));
		return {
			type: "type",
			text: parseQuotedString(parts.slice(1).join(" ")),
			...speed !== void 0 ? { speed } : {}
		};
	}
	if (cmdLower.startsWith("ctrl+")) return {
		type: "ctrl",
		key: cmd.slice(5)
	};
	if (cmdLower.startsWith("alt+")) return {
		type: "alt",
		key: cmd.slice(4)
	};
	if (cmdLower === "sleep") return {
		type: "sleep",
		ms: parseDuration(parts[1] ?? "0")
	};
	if (cmdLower === "screenshot") return {
		type: "screenshot",
		path: parts.length > 1 ? parts.slice(1).join(" ") : void 0
	};
	if (cmdLower === "hide") return { type: "hide" };
	if (cmdLower === "show") return { type: "show" };
	if (cmdLower === "source") return {
		type: "source",
		path: parts.slice(1).join(" ")
	};
	if (cmdLower === "require") return {
		type: "require",
		program: parts[1] ?? ""
	};
	if (cmdLower === "expect") {
		const text = parseQuotedString(parts[1] ?? "");
		let timeout;
		if (parts.length > 2) timeout = parseDuration(parts[2]);
		return {
			type: "expect",
			text,
			...timeout !== void 0 ? { timeout } : {}
		};
	}
	if (KEY_COMMANDS.has(cmdLower)) {
		const count = parts.length > 1 ? Number.parseInt(parts[1], 10) : void 0;
		return {
			type: "key",
			key: cmd,
			...count !== void 0 && count > 1 ? { count } : {}
		};
	}
	return {
		type: "key",
		key: cmd
	};
}
/**
* Split a command line into parts, respecting quoted strings.
*/
function splitCommandLine(line) {
	const parts = [];
	let current = "";
	let inQuote = false;
	let escaped = false;
	for (const ch of line) {
		if (escaped) {
			current += ch;
			escaped = false;
			continue;
		}
		if (ch === "\\") {
			escaped = true;
			current += ch;
			continue;
		}
		if (ch === "\"") {
			inQuote = !inQuote;
			current += ch;
			continue;
		}
		if (ch === " " && !inQuote) {
			if (current.length > 0) {
				parts.push(current);
				current = "";
			}
			continue;
		}
		current += ch;
	}
	if (current.length > 0) parts.push(current);
	return parts;
}
/**
* Parse a VHS .tape file format string into a TapeFile.
*
* The tape format is line-based. Each line is either:
* - A comment (starting with #)
* - A blank line (ignored)
* - A command (Output, Set, Type, Enter, Sleep, Screenshot, etc.)
*
* Set commands are collected into the `settings` map in addition to
* appearing in the `commands` array.
*/
function parseTape(source) {
	const lines = source.split("\n");
	const commands = [];
	const settings = {};
	for (const line of lines) {
		const cmd = parseLine(line);
		if (cmd === null) continue;
		commands.push(cmd);
		if (cmd.type === "set") settings[cmd.key] = cmd.value;
	}
	return {
		commands,
		settings
	};
}
//#endregion
//#region src/compile.ts
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const DEFAULT_TYPING_SPEED = 50;
const DEFAULT_KEY_DELAY = 50;
function compilePlaybackSource(source, options = {}) {
	if (detectFormat(source, options.filename) === "asciicast") return compileAsciicastSource(source, options);
	return compileTapeSource(source, options);
}
function compileAsciicastSource(source, options = {}) {
	const recording = parseAsciicast(source);
	const cols = options.cols ?? recording.header.width;
	const rows = options.rows ?? recording.header.height;
	const events = [{
		at: 0,
		type: "resize",
		cols,
		rows
	}];
	for (const event of recording.events) events.push(asciicastEventToPlaybackEvent(event, options));
	const eventDuration = Math.max(0, ...events.map((event) => event.at));
	const headerDuration = recording.header.duration === void 0 ? 0 : Math.round(recording.header.duration * 1e3);
	return {
		format: "asciicast",
		cols,
		rows,
		durationMs: Math.max(eventDuration, headerDuration),
		events: sortEvents(events),
		warnings: [],
		...recording.header.title ? { title: recording.header.title } : {}
	};
}
function compileTapeSource(source, options = {}) {
	return compileTape(parseTape(source), options);
}
function compileTape(tape, options = {}) {
	let cols = integerSetting(options.cols, tape.settings.Columns, tape.settings.Cols, tape.settings.Width) ?? DEFAULT_COLS;
	let rows = integerSetting(options.rows, tape.settings.Rows, tape.settings.Height) ?? DEFAULT_ROWS;
	const defaultTypingSpeed = options.defaultTypingSpeed ?? durationSetting(tape.settings.TypingSpeed, DEFAULT_TYPING_SPEED);
	const keyDelay = options.keyDelay ?? DEFAULT_KEY_DELAY;
	const echoTapeInput = options.echoTapeInput ?? true;
	const events = [{
		at: 0,
		type: "resize",
		cols,
		rows
	}];
	const warnings = [];
	let at = 0;
	let visible = true;
	const pushInput = (data, displayData = data) => {
		events.push({
			at,
			type: "input",
			data,
			visible
		});
		if (visible && echoTapeInput && displayData.length > 0) events.push({
			at,
			type: "output",
			data: displayData
		});
	};
	for (const command of tape.commands) switch (command.type) {
		case "set": {
			const key = command.key.toLowerCase();
			if (key === "width" || key === "cols" || key === "columns") {
				const nextCols = Number.parseInt(command.value, 10);
				if (Number.isFinite(nextCols) && nextCols > 0 && nextCols !== cols) {
					cols = nextCols;
					events.push({
						at,
						type: "resize",
						cols,
						rows
					});
				}
			} else if (key === "height" || key === "rows") {
				const nextRows = Number.parseInt(command.value, 10);
				if (Number.isFinite(nextRows) && nextRows > 0 && nextRows !== rows) {
					rows = nextRows;
					events.push({
						at,
						type: "resize",
						cols,
						rows
					});
				}
			}
			break;
		}
		case "type": {
			const speed = command.speed ?? defaultTypingSpeed;
			for (const char of command.text) {
				pushInput(char);
				at += speed;
			}
			break;
		}
		case "key": {
			const count = command.count ?? 1;
			for (let i = 0; i < count; i++) {
				const data = keyInputData(command.key);
				pushInput(data, keyDisplayData(command.key, data));
				at += keyDelay;
			}
			break;
		}
		case "ctrl":
			pushInput(modifiedKeyInputData("Ctrl", command.key), "");
			at += keyDelay;
			break;
		case "alt":
			pushInput(modifiedKeyInputData("Alt", command.key), "");
			at += keyDelay;
			break;
		case "sleep":
			at += command.ms;
			break;
		case "hide":
			visible = false;
			events.push({
				at,
				type: "visibility",
				visible
			});
			break;
		case "show":
			visible = true;
			events.push({
				at,
				type: "visibility",
				visible
			});
			break;
		case "expect":
			events.push({
				at,
				type: "marker",
				label: `Expect: ${command.text}`
			});
			break;
		case "screenshot":
			events.push({
				at,
				type: "marker",
				label: command.path ? `Screenshot: ${command.path}` : "Screenshot"
			});
			break;
		case "source":
			warnings.push(`Source commands are not resolved by the browser player: ${command.path}`);
			break;
		case "require":
			warnings.push(`Require commands are not checked by the browser player: ${command.program}`);
			break;
		case "output": break;
	}
	return {
		format: "tape",
		cols,
		rows,
		durationMs: Math.max(at, ...events.map((event) => event.at)),
		events: sortEvents(events),
		warnings
	};
}
function detectFormat(source, filename) {
	if (filename?.toLowerCase().endsWith(".cast")) return "asciicast";
	if (filename?.toLowerCase().endsWith(".tape")) return "tape";
	const firstLine = source.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0);
	if (!firstLine?.startsWith("{")) return "tape";
	try {
		return JSON.parse(firstLine).version === 2 ? "asciicast" : "tape";
	} catch {
		return "tape";
	}
}
function asciicastEventToPlaybackEvent(event, options) {
	const at = Math.round(event.time * 1e3);
	if (event.type === "o") return {
		at,
		type: "output",
		data: event.data
	};
	if (event.type === "i") return {
		at,
		type: "input",
		data: event.data,
		visible: options.showAsciicastInput ?? false
	};
	return {
		at,
		type: "marker",
		label: event.data
	};
}
function sortEvents(events) {
	const priority = {
		resize: 0,
		visibility: 1,
		input: 2,
		output: 3,
		marker: 4
	};
	return [...events].sort((a, b) => a.at - b.at || priority[a.type] - priority[b.type]);
}
function integerSetting(option, ...settings) {
	if (option !== void 0) return option;
	for (const value of settings) {
		if (!value) continue;
		const parsed = Number.parseInt(value, 10);
		if (Number.isFinite(parsed) && parsed > 0) return parsed;
	}
}
function durationSetting(value, fallback) {
	if (!value) return fallback;
	const parsed = parseDuration(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}
function keyInputData(key) {
	return keyToAnsi(parseKey(normalizeKeyName(key)));
}
function modifiedKeyInputData(modifier, key) {
	return keyToAnsi(parseKey(`${modifier}+${key}`));
}
function keyDisplayData(key, inputData) {
	switch (key.toLowerCase()) {
		case "enter": return "\r\n";
		case "space": return " ";
		case "backspace": return "\b \b";
		case "delete":
		case "escape":
		case "tab":
		case "up":
		case "down":
		case "left":
		case "right":
		case "home":
		case "end":
		case "pageup":
		case "pagedown": return inputData;
		default: return "";
	}
}
function normalizeKeyName(key) {
	return {
		up: "ArrowUp",
		down: "ArrowDown",
		left: "ArrowLeft",
		right: "ArrowRight",
		pageup: "PageUp",
		pagedown: "PageDown"
	}[key.toLowerCase()] ?? key;
}
//#endregion
//#region src/controller.ts
function createPlaybackController(playback, sink, options = {}) {
	let status = "idle";
	let currentTimeMs = 0;
	let runId = 0;
	const isStopped = () => status === "stopped";
	const state = () => ({
		status,
		currentTimeMs,
		durationMs: playback.durationMs
	});
	const stop = () => {
		runId++;
		status = "stopped";
	};
	const pause = () => {
		if (status === "playing") status = "paused";
	};
	const resume = () => {
		if (status === "paused") status = "playing";
	};
	const dispose = () => {
		stop();
	};
	const play = async (runOptions = {}) => {
		const thisRun = ++runId;
		const speed = runOptions.speed ?? 1;
		const instant = speed === 0 || !Number.isFinite(speed);
		const startAtMs = runOptions.startAtMs ?? 0;
		const shouldReset = runOptions.reset ?? true;
		status = "playing";
		currentTimeMs = startAtMs;
		if (shouldReset) {
			await sink.reset?.();
			await sink.resize?.(playback.cols, playback.rows);
		}
		let previousAt = startAtMs;
		for (const event of playback.events) {
			if (event.at < startAtMs) continue;
			if (thisRun !== runId || isStopped()) return;
			const delayMs = instant ? 0 : Math.max(0, (event.at - previousAt) / speed);
			if (delayMs > 0) await waitForPlaybackDelay(delayMs, () => thisRun === runId && !isStopped(), () => status === "paused");
			if (thisRun !== runId || isStopped()) return;
			await dispatchEvent(event, sink, options);
			currentTimeMs = event.at;
			previousAt = event.at;
		}
		if (thisRun === runId) {
			currentTimeMs = playback.durationMs;
			status = "ended";
		}
	};
	const seek = async (timeMs) => {
		const boundedTime = Math.max(0, Math.min(timeMs, playback.durationMs));
		runId++;
		status = "idle";
		currentTimeMs = boundedTime;
		await sink.reset?.();
		await sink.resize?.(playback.cols, playback.rows);
		for (const event of playback.events) {
			if (event.at > boundedTime) break;
			await dispatchEvent(event, sink, options, { emitCallbacks: false });
		}
	};
	return {
		play,
		pause,
		resume,
		stop,
		seek,
		state,
		dispose
	};
}
async function dispatchEvent(event, sink, options, dispatchOptions = {}) {
	const emitCallbacks = dispatchOptions.emitCallbacks ?? true;
	if (emitCallbacks) options.onEvent?.(event);
	switch (event.type) {
		case "resize":
			await sink.resize?.(event.cols, event.rows);
			break;
		case "output":
			await sink.write(event.data);
			break;
		case "input":
			if (emitCallbacks) options.onInput?.(event);
			break;
		case "marker":
			if (emitCallbacks) options.onMarker?.(event);
			break;
		case "visibility": break;
	}
}
function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitForPlaybackDelay(ms, isActive, isPaused) {
	let remaining = ms;
	let lastTick = Date.now();
	while (remaining > 0 && isActive()) {
		if (isPaused()) {
			await delay(16);
			lastTick = Date.now();
			continue;
		}
		await delay(Math.min(16, remaining));
		const now = Date.now();
		remaining -= now - lastTick;
		lastTick = now;
	}
}
//#endregion
export { compileTapeSource as a, compileTape as i, compileAsciicastSource as n, compilePlaybackSource as r, createPlaybackController as t };

//# sourceMappingURL=controller-YzWg3Kod.mjs.map