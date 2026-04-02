/**
 * asciicast v2 reader and replayer.
 *
 * Parses asciicast v2 JSON-lines files and replays them through
 * a termless Terminal or TerminalBackend.
 */

import type { Terminal, TerminalBackend } from "../types.ts"
import type { AsciicastEvent, AsciicastEventType, AsciicastRecording } from "./types.ts"

/** Options for replaying an asciicast recording. */
export interface ReplayOptions {
  /** Speed multiplier (default: 1). Higher = faster. 0 or Infinity = instant. */
  speed?: number
  /** Called for each event during replay. */
  onEvent?: (event: AsciicastEvent) => void
}

/**
 * Parse an asciicast v2 file from its string content.
 *
 * Handles both `\n` and `\r\n` line endings. Validates the header
 * version (must be 2) and parses event tuples.
 *
 * @throws {Error} If the content is empty, the header is missing version 2,
 *   or an event line has an invalid format.
 */
export function parseAsciicast(content: string): AsciicastRecording {
  // Split on \n, handling \r\n by trimming \r from each line
  const lines = content.split("\n").filter((line) => line.trim().length > 0)

  if (lines.length === 0) {
    throw new Error("Empty asciicast file")
  }

  // Parse header (first line)
  const headerLine = lines[0]!.replace(/\r$/, "")
  const header = JSON.parse(headerLine)

  if (header.version !== 2) {
    throw new Error(`Unsupported asciicast version: ${header.version} (expected 2)`)
  }

  // Parse events (remaining lines)
  const events: AsciicastEvent[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.replace(/\r$/, "")
    const tuple = JSON.parse(line)

    if (!Array.isArray(tuple) || tuple.length < 3) {
      throw new Error(`Invalid event at line ${i + 1}: expected [time, type, data]`)
    }

    const [time, type, data] = tuple as [number, AsciicastEventType, string]
    events.push({ time, type, data })
  }

  return { header, events }
}

/** Type guard: is target a Terminal (has feed that accepts string)? */
function isTerminal(target: Terminal | TerminalBackend): target is Terminal {
  // Terminal.feed accepts string | Uint8Array; TerminalBackend.feed accepts only Uint8Array.
  // We check for the `cols` property that Terminal has as a readonly number.
  return "cols" in target && "press" in target
}

/**
 * Replay an asciicast recording through a terminal.
 *
 * Feeds "o" (output) events to the terminal via `feed()`. Input ("i") events
 * are skipped during replay — they record what the user typed, not what
 * should drive the terminal. Marker ("m") events are reported via onEvent
 * but don't feed data.
 *
 * By default, replay preserves original timing. Set `speed` to adjust:
 * - `speed: 2` = 2x faster
 * - `speed: Infinity` or `speed: 0` = instant (no delays)
 */
export async function replayAsciicast(
  recording: AsciicastRecording,
  terminal: Terminal | TerminalBackend,
  options?: ReplayOptions,
): Promise<void> {
  const speed = options?.speed ?? 1
  const instant = speed === 0 || !Number.isFinite(speed)
  const encoder = new TextEncoder()

  let lastTime = 0

  for (const event of recording.events) {
    // Wait for timing gap (unless instant)
    if (!instant && event.time > lastTime) {
      const delay = ((event.time - lastTime) / speed) * 1000
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    lastTime = event.time

    // Notify callback
    options?.onEvent?.(event)

    // Only feed output events
    if (event.type === "o") {
      if (isTerminal(terminal)) {
        terminal.feed(event.data)
      } else {
        terminal.feed(encoder.encode(event.data))
      }
    }
  }
}
