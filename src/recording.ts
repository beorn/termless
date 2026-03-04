/**
 * Recording and replay for terminal I/O sessions.
 *
 * Captures input/output events with timestamps during a recording session.
 * Recordings are JSON-serializable for storage and sharing. Replay feeds
 * events back to a terminal with timing preserved.
 */

import type { Terminal } from "./types.ts"

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
