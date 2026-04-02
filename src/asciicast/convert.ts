/**
 * Conversion between termless Recording and asciicast v2 formats.
 */

import type { Recording, RecordedEvent } from "../recording.ts"
import type { AsciicastEvent, AsciicastHeader, AsciicastRecording } from "./types.ts"

/** Options for converting a termless recording to asciicast. */
export interface ConvertOptions {
  title?: string
  /** Override width (defaults to recording cols). */
  width?: number
  /** Override height (defaults to recording rows). */
  height?: number
}

/**
 * Convert a termless Recording to an AsciicastRecording.
 *
 * Maps event types: "output" → "o", "input" → "i".
 * Converts timestamps from milliseconds to seconds.
 */
export function recordingToAsciicast(data: Recording, options?: ConvertOptions): AsciicastRecording {
  const header: AsciicastHeader = {
    version: 2,
    width: options?.width ?? data.cols,
    height: options?.height ?? data.rows,
    duration: data.duration / 1000,
  }
  if (options?.title) header.title = options.title

  const events: AsciicastEvent[] = data.events.map((event) => ({
    time: event.timestamp / 1000,
    type: event.type === "output" ? "o" : "i",
    data: event.data,
  }))

  return { header, events }
}

/**
 * Convert an AsciicastRecording to a termless Recording.
 *
 * Maps event types: "o" → "output", "i" → "input".
 * Marker ("m") events are dropped (no termless equivalent).
 * Converts timestamps from seconds to milliseconds.
 */
export function asciicastToRecording(recording: AsciicastRecording): Recording {
  const events: RecordedEvent[] = []

  for (const event of recording.events) {
    // Skip marker events — no termless equivalent
    if (event.type === "m") continue

    events.push({
      timestamp: Math.round(event.time * 1000),
      type: event.type === "o" ? "output" : "input",
      data: event.data,
    })
  }

  const duration =
    recording.header.duration != null
      ? Math.round(recording.header.duration * 1000)
      : events.length > 0
        ? events[events.length - 1]!.timestamp
        : 0

  return {
    version: 1,
    cols: recording.header.width,
    rows: recording.header.height,
    duration,
    events,
  }
}
