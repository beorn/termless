/**
 * asciicast v2 streaming writer.
 *
 * Builds an asciicast v2 file incrementally from timestamped events. To
 * serialize a captured {@link Recording} to `.cast`, use `encodeAsciicast`
 * from `asciicast/recording-codec.ts` — the symmetric `.cast` codec.
 */

import type { AsciicastHeader } from "./types.ts"

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
