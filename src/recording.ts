/**
 * Recording and replay for terminal I/O sessions.
 *
 * Captures input/output events with timestamps during a recording session.
 * Recordings are JSON-serializable for storage and sharing. Replay feeds
 * events back to a terminal with timing preserved.
 *
 * Also provides visual state snapshotting for change detection — captures
 * the full visual state (cell styles, cursor, modes, title) as a
 * deterministic string, so frame recorders can detect non-text changes
 * like cursor style, color, and mode transitions.
 */

import type { Cell, RGB, Terminal, TerminalReadable, TerminalMode, UnderlineStyle } from "./types.ts"

// =============================================================================
// Types
// =============================================================================

/** A single recorded event (input or output). */
export interface RecordedEvent {
  /** Timestamp in milliseconds relative to recording start. */
  timestamp: number
  /** Event type: "input" for data sent to terminal, "output" for data received. */
  type: "input" | "output"
  /** The data as a string. */
  data: string
}

/** A complete recording of a terminal session. */
export interface Recording {
  /** Recording format version. */
  version: 1
  /** Terminal dimensions at recording start. */
  cols: number
  /** Terminal dimensions at recording start. */
  rows: number
  /** Total duration in milliseconds. */
  duration: number
  /** Recorded events in chronological order. */
  events: RecordedEvent[]
}

/** Handle returned by startRecording() to control the active recording. */
export interface RecordingHandle {
  /** Record an input event (data sent to the terminal). */
  recordInput(data: string): void
  /** Record an output event (data received from the terminal). */
  recordOutput(data: string): void
  /** Stop recording and return the completed Recording. */
  stop(): Recording
}

// =============================================================================
// Recording
// =============================================================================

/**
 * Start recording terminal I/O events.
 *
 * Returns a handle that captures input/output events with timestamps.
 * Call `stop()` to finalize and get the JSON-serializable Recording.
 *
 * @example
 * ```ts
 * const handle = startRecording(terminal)
 * handle.recordOutput("$ ")
 * handle.recordInput("ls\n")
 * handle.recordOutput("file1  file2\n$ ")
 * const recording = handle.stop()
 * // recording is JSON-serializable
 * ```
 */
export function startRecording(terminal: Terminal): RecordingHandle {
  const startTime = Date.now()
  const events: RecordedEvent[] = []
  let stopped = false

  return {
    recordInput(data: string): void {
      if (stopped) throw new Error("Recording has been stopped")
      events.push({
        timestamp: Date.now() - startTime,
        type: "input",
        data,
      })
    },

    recordOutput(data: string): void {
      if (stopped) throw new Error("Recording has been stopped")
      events.push({
        timestamp: Date.now() - startTime,
        type: "output",
        data,
      })
    },

    stop(): Recording {
      if (stopped) throw new Error("Recording has already been stopped")
      stopped = true
      const duration = Date.now() - startTime
      return {
        version: 1,
        cols: terminal.cols,
        rows: terminal.rows,
        duration,
        events,
      }
    },
  }
}

// =============================================================================
// Replay
// =============================================================================

/**
 * Replay a recording into a terminal.
 *
 * Feeds output events to the terminal via `feed()`. Input events are
 * included in the recording for completeness but are not sent during
 * replay (the terminal is being driven by recorded output, not real input).
 *
 * By default, replay is instant (no delays). Pass `{ realtime: true }` to
 * replay with original timing.
 *
 * @example
 * ```ts
 * // Instant replay (synchronous for output events)
 * await replayRecording(terminal, recording)
 *
 * // Real-time replay with original timing
 * await replayRecording(terminal, recording, { realtime: true })
 * ```
 */
export async function replayRecording(
  terminal: Terminal,
  recording: Recording,
  options?: { realtime?: boolean },
): Promise<void> {
  const realtime = options?.realtime ?? false

  let lastTimestamp = 0
  for (const event of recording.events) {
    if (realtime && event.timestamp > lastTimestamp) {
      const delay = event.timestamp - lastTimestamp
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    lastTimestamp = event.timestamp

    if (event.type === "output") {
      terminal.feed(event.data)
    }
    // Input events are recorded for completeness but not replayed --
    // the terminal is driven by the recorded output stream.
  }
}

// =============================================================================
// Visual State Snapshotting
// =============================================================================

/** Modes that affect visual appearance and should be tracked for change detection. */
const VISUAL_MODES: TerminalMode[] = ["altScreen", "cursorVisible", "reverseVideo"]

function rgbToString(color: RGB | null): string {
  if (color === null) return "-"
  return `${color.r},${color.g},${color.b}`
}

function underlineToString(u: UnderlineStyle): string {
  return u === false ? "0" : u
}

function cellToString(cell: Cell): string {
  // Encode all visually-relevant cell properties into a compact string.
  // Order: char|fg|bg|bold|dim|italic|underline|underlineColor|strikethrough|inverse|blink|hidden|wide|hyperlink
  return `${cell.char}|${rgbToString(cell.fg)}|${rgbToString(cell.bg)}|${cell.bold ? 1 : 0}${cell.dim ? 1 : 0}${cell.italic ? 1 : 0}${underlineToString(cell.underline)}|${rgbToString(cell.underlineColor)}|${cell.strikethrough ? 1 : 0}${cell.inverse ? 1 : 0}${cell.blink ? 1 : 0}${cell.hidden ? 1 : 0}${cell.wide ? 1 : 0}|${cell.hyperlink ?? "-"}`
}

/**
 * Snapshot the full visual state of a terminal as a deterministic string.
 *
 * Captures everything that affects what the user sees:
 * - Cell content AND styles (fg, bg, bold, italic, underline, etc.)
 * - Cursor position, style, and visibility
 * - Terminal modes (alt screen, reverse video)
 * - Window title
 *
 * Two terminals that look identical produce identical snapshots.
 * Any visual difference — even just a color change on one cell —
 * produces a different snapshot.
 *
 * Use this for frame change detection instead of text-only comparison:
 *
 * @example
 * ```ts
 * let previousSnapshot: string | null = null
 * // ... in capture loop:
 * const snapshot = snapshotVisualState(terminal)
 * if (snapshot !== previousSnapshot) {
 *   captureFrame()
 *   previousSnapshot = snapshot
 * }
 * ```
 */
export function snapshotVisualState(readable: TerminalReadable): string {
  const parts: string[] = []

  // Cursor state
  const cursor = readable.getCursor()
  parts.push(`C:${cursor.x},${cursor.y},${cursor.visible},${cursor.style}`)

  // Title
  parts.push(`T:${readable.getTitle()}`)

  // Visual modes
  const modeFlags = VISUAL_MODES.map((m) => (readable.getMode(m) ? "1" : "0")).join("")
  parts.push(`M:${modeFlags}`)

  // Cell grid — every cell's full visual state
  const lines = readable.getLines()
  for (let row = 0; row < lines.length; row++) {
    const rowCells = lines[row]!
    const cellStrings: string[] = []
    for (let col = 0; col < rowCells.length; col++) {
      cellStrings.push(cellToString(rowCells[col]!))
    }
    parts.push(`R${row}:${cellStrings.join(";")}`)
  }

  return parts.join("\n")
}
