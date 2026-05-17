import { parseKey, keyToAnsi } from "../../../src/key-mapping.ts"
import { parseAsciicast } from "../../../src/asciicast/reader.ts"
import { parseTape, parseDuration } from "../../../src/tape/parser.ts"
import type { AsciicastEvent } from "../../../src/asciicast/types.ts"
import type { TapeCommand, TapeFile } from "../../../src/tape/parser.ts"
import type { CompiledPlayback, CompilePlaybackOptions, PlaybackEvent } from "./types.ts"

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const DEFAULT_TYPING_SPEED = 50
const DEFAULT_KEY_DELAY = 50

export function compilePlaybackSource(source: string, options: CompilePlaybackOptions = {}): CompiledPlayback {
  if (detectFormat(source, options.filename) === "asciicast") {
    return compileAsciicastSource(source, options)
  }
  return compileTapeSource(source, options)
}

export function compileAsciicastSource(source: string, options: CompilePlaybackOptions = {}): CompiledPlayback {
  const recording = parseAsciicast(source)
  const cols = options.cols ?? recording.header.width
  const rows = options.rows ?? recording.header.height
  const events: PlaybackEvent[] = [{ at: 0, type: "resize", cols, rows }]

  for (const event of recording.events) {
    events.push(asciicastEventToPlaybackEvent(event, options))
  }

  const eventDuration = Math.max(0, ...events.map((event) => event.at))
  const headerDuration = recording.header.duration === undefined ? 0 : Math.round(recording.header.duration * 1000)

  return {
    format: "asciicast",
    cols,
    rows,
    durationMs: Math.max(eventDuration, headerDuration),
    events: sortEvents(events),
    warnings: [],
    ...(recording.header.title ? { title: recording.header.title } : {}),
  }
}

export function compileTapeSource(source: string, options: CompilePlaybackOptions = {}): CompiledPlayback {
  const tape = parseTape(source)
  return compileTape(tape, options)
}

export function compileTape(tape: TapeFile, options: CompilePlaybackOptions = {}): CompiledPlayback {
  let cols =
    integerSetting(options.cols, tape.settings.Columns, tape.settings.Cols, tape.settings.Width) ?? DEFAULT_COLS
  let rows = integerSetting(options.rows, tape.settings.Rows, tape.settings.Height) ?? DEFAULT_ROWS
  const defaultTypingSpeed =
    options.defaultTypingSpeed ?? durationSetting(tape.settings.TypingSpeed, DEFAULT_TYPING_SPEED)
  const keyDelay = options.keyDelay ?? DEFAULT_KEY_DELAY
  const echoTapeInput = options.echoTapeInput ?? true

  const events: PlaybackEvent[] = [{ at: 0, type: "resize", cols, rows }]
  const warnings: string[] = []
  let at = 0
  let visible = true

  const pushInput = (data: string, displayData = data): void => {
    events.push({ at, type: "input", data, visible })
    if (visible && echoTapeInput && displayData.length > 0) {
      events.push({ at, type: "output", data: displayData })
    }
  }

  for (const command of tape.commands) {
    switch (command.type) {
      case "set": {
        const key = command.key.toLowerCase()
        if (key === "width" || key === "cols" || key === "columns") {
          const nextCols = Number.parseInt(command.value, 10)
          if (Number.isFinite(nextCols) && nextCols > 0 && nextCols !== cols) {
            cols = nextCols
            events.push({ at, type: "resize", cols, rows })
          }
        } else if (key === "height" || key === "rows") {
          const nextRows = Number.parseInt(command.value, 10)
          if (Number.isFinite(nextRows) && nextRows > 0 && nextRows !== rows) {
            rows = nextRows
            events.push({ at, type: "resize", cols, rows })
          }
        }
        break
      }

      case "type": {
        const speed = command.speed ?? defaultTypingSpeed
        for (const char of command.text) {
          pushInput(char)
          at += speed
        }
        break
      }

      case "key": {
        const count = command.count ?? 1
        for (let i = 0; i < count; i++) {
          const data = keyInputData(command.key)
          pushInput(data, keyDisplayData(command.key, data))
          at += keyDelay
        }
        break
      }

      case "ctrl": {
        const data = modifiedKeyInputData("Ctrl", command.key)
        pushInput(data, "")
        at += keyDelay
        break
      }

      case "alt": {
        const data = modifiedKeyInputData("Alt", command.key)
        pushInput(data, "")
        at += keyDelay
        break
      }

      case "sleep":
        at += command.ms
        break

      case "hide":
        visible = false
        events.push({ at, type: "visibility", visible })
        break

      case "show":
        visible = true
        events.push({ at, type: "visibility", visible })
        break

      case "expect":
        events.push({ at, type: "marker", label: `Expect: ${command.text}` })
        break

      case "screenshot":
        events.push({ at, type: "marker", label: command.path ? `Screenshot: ${command.path}` : "Screenshot" })
        break

      case "source":
        warnings.push(`Source commands are not resolved by the browser player: ${command.path}`)
        break

      case "require":
        warnings.push(`Require commands are not checked by the browser player: ${command.program}`)
        break

      case "output":
        break
    }
  }

  return {
    format: "tape",
    cols,
    rows,
    durationMs: Math.max(at, ...events.map((event) => event.at)),
    events: sortEvents(events),
    warnings,
  }
}

function detectFormat(source: string, filename: string | undefined): "asciicast" | "tape" {
  if (filename?.toLowerCase().endsWith(".cast")) return "asciicast"
  if (filename?.toLowerCase().endsWith(".tape")) return "tape"

  const firstLine = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  if (!firstLine?.startsWith("{")) return "tape"

  try {
    const header = JSON.parse(firstLine) as { version?: unknown }
    return header.version === 2 ? "asciicast" : "tape"
  } catch {
    return "tape"
  }
}

function asciicastEventToPlaybackEvent(event: AsciicastEvent, options: CompilePlaybackOptions): PlaybackEvent {
  const at = Math.round(event.time * 1000)
  if (event.type === "o") {
    return { at, type: "output", data: event.data }
  }
  if (event.type === "i") {
    return { at, type: "input", data: event.data, visible: options.showAsciicastInput ?? false }
  }
  return { at, type: "marker", label: event.data }
}

function sortEvents(events: PlaybackEvent[]): PlaybackEvent[] {
  const priority: Record<PlaybackEvent["type"], number> = {
    resize: 0,
    visibility: 1,
    input: 2,
    output: 3,
    marker: 4,
  }
  return [...events].sort((a, b) => a.at - b.at || priority[a.type] - priority[b.type])
}

function integerSetting(option: number | undefined, ...settings: (string | undefined)[]): number | undefined {
  if (option !== undefined) return option
  for (const value of settings) {
    if (!value) continue
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return undefined
}

function durationSetting(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = parseDuration(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function keyInputData(key: string): string {
  const normalized = normalizeKeyName(key)
  return keyToAnsi(parseKey(normalized))
}

function modifiedKeyInputData(modifier: "Alt" | "Ctrl", key: string): string {
  return keyToAnsi(parseKey(`${modifier}+${key}`))
}

function keyDisplayData(key: string, inputData: string): string {
  switch (key.toLowerCase()) {
    case "enter":
      return "\r\n"
    case "space":
      return " "
    case "backspace":
      return "\b \b"
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
    case "pagedown":
      return inputData
    default:
      return ""
  }
}

function normalizeKeyName(key: string): string {
  const map: Record<string, string> = {
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
    pageup: "PageUp",
    pagedown: "PageDown",
  }
  return map[key.toLowerCase()] ?? key
}
