/**
 * asciicast v2 writer.
 *
 * Converts termless recordings to asciicast v2 format and provides
 * a streaming writer for building asciicast files incrementally.
 */

import type { Recording } from "../recording.ts"
import type { AsciicastHeader, AsciicastRecording } from "./types.ts"

/** Options for converting a termless recording to asciicast. */
export interface ToAsciicastOptions {
  title?: string
}

/**
 * Convert a termless Recording to an asciicast v2 string (JSON-lines).
 *
 * Maps termless "output"/"input" event types to asciicast "o"/"i" types,
 * and converts timestamps from milliseconds to seconds.
 */
export function toAsciicast(recording: Recording, options?: ToAsciicastOptions): string {
  const header: AsciicastHeader = {
    version: 2,
    width: recording.cols,
    height: recording.rows,
    duration: recording.duration / 1000,
  }
  if (options?.title) header.title = options.title

  const lines: string[] = [JSON.stringify(header)]

  for (const event of recording.events) {
    const time = event.timestamp / 1000
    const type = event.type === "output" ? "o" : "i"
    lines.push(JSON.stringify([time, type, event.data]))
  }

  return lines.join("\n") + "\n"
}

/** Handle for streaming asciicast writes. */
export interface AsciicastWriter {
  /** Write an output ("o") event with auto-timestamp. */
  writeOutput(data: string): void
  /** Write an input ("i") event with auto-timestamp. */
  writeInput(data: string): void
  /** Write a marker ("m") event with auto-timestamp. */
  writeMarker(label: string): void
  /** Finalize the writer and return the complete asciicast string. */
  close(): string
}

/**
 * Create a streaming asciicast writer that accumulates events.
 *
 * Events are timestamped relative to when the writer was created.
 * Call `close()` to get the final JSON-lines string.
 */
export function createAsciicastWriter(header: AsciicastHeader): AsciicastWriter {
  const startTime = Date.now()
  const lines: string[] = [JSON.stringify(header)]
  let closed = false

  function elapsed(): number {
    return (Date.now() - startTime) / 1000
  }

  function writeEvent(type: string, data: string): void {
    if (closed) throw new Error("AsciicastWriter has been closed")
    lines.push(JSON.stringify([elapsed(), type, data]))
  }

  return {
    writeOutput(data: string): void {
      writeEvent("o", data)
    },
    writeInput(data: string): void {
      writeEvent("i", data)
    },
    writeMarker(label: string): void {
      writeEvent("m", label)
    },
    close(): string {
      if (closed) throw new Error("AsciicastWriter has already been closed")
      closed = true
      return lines.join("\n") + "\n"
    },
  }
}
