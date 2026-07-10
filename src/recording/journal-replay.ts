/**
 * Terminal-session journal replay.
 *
 * Replays a persistent terminal-session journal (km's `@hh/terminal-session`
 * shape) through any termless Terminal/TerminalBackend for deterministic
 * recording, conformance, and visual fixtures. The input types are kept
 * STRUCTURAL — no dependency on the producing package — following the same
 * dependency-free pattern as `SilveryRenderEvent`: km-side adapters convert
 * real journals into this shape; termless stays standalone.
 *
 * Byte payloads ride as base64 (`bytesB64`) so fixtures stay JSON. Only
 * `output` and `resize` events mutate terminal state; `input`, `lifecycle`,
 * and `truncation` events are surfaced in the result for assertions.
 */

/**
 * Structural minimum a replay target must provide. `TestTerminal` and
 * `TerminalBackend` both satisfy it; so does a thin wrapper over a guest
 * handle (`feedAnsi` + the size owner's `requestResize`).
 */
export interface JournalReplayTarget {
  feed(data: Uint8Array): void
  resize(cols: number, rows: number): void
}

export interface JournalReplayEvent {
  kind: "output" | "input" | "resize" | "lifecycle" | "truncation"
  offset: number
  at: number
  /** base64 raw bytes for output/input events. */
  bytesB64?: string
  /** cols/rows for resize events. */
  size?: { cols: number; rows: number }
  /** state label for lifecycle events. */
  state?: string
  /** oldest retained offset for truncation markers. */
  retainedFromOffset?: number
}

export interface JournalReplayInput {
  /** Initial terminal size before any events (resize events override). */
  size?: { cols: number; rows: number }
  events: JournalReplayEvent[]
}

export interface JournalReplayResult {
  /** Count of events that mutated terminal state (output + resize). */
  applied: number
  /** Offsets of truncation markers seen (history older than these is gone). */
  truncations: number[]
  /** Lifecycle states seen, in order (e.g. launching, awake, exited). */
  lifecycle: string[]
}

/** Replay journal events through a backend/terminal via its byte feed. */
export function replayJournal(input: JournalReplayInput, target: JournalReplayTarget): JournalReplayResult {
  if (input.size !== undefined) target.resize(input.size.cols, input.size.rows)
  const result: JournalReplayResult = { applied: 0, truncations: [], lifecycle: [] }
  for (const event of input.events) {
    switch (event.kind) {
      case "output": {
        target.feed(base64ToBytes(expectB64(event)))
        result.applied += 1
        break
      }
      case "resize": {
        if (event.size === undefined) throw new Error(`journal replay: resize at offset ${event.offset} missing size`)
        target.resize(event.size.cols, event.size.rows)
        result.applied += 1
        break
      }
      case "truncation": {
        if (event.retainedFromOffset === undefined) {
          throw new Error(`journal replay: truncation at offset ${event.offset} missing retainedFromOffset`)
        }
        result.truncations.push(event.retainedFromOffset)
        break
      }
      case "lifecycle": {
        if (event.state !== undefined) result.lifecycle.push(event.state)
        break
      }
      case "input":
        // Input bytes are what a CLIENT sent; replaying them as terminal
        // output would corrupt the screen. They exist for assertions only.
        break
    }
  }
  return result
}

/** Parse a JSON journal fixture (object or serialized string). */
export function parseJournalFixture(content: string): JournalReplayInput {
  const parsed = JSON.parse(content) as JournalReplayInput
  if (!Array.isArray(parsed.events)) throw new Error("journal fixture: events must be an array")
  return parsed
}

function expectB64(event: JournalReplayEvent): string {
  if (event.bytesB64 === undefined) {
    throw new Error(`journal replay: ${event.kind} at offset ${event.offset} missing bytesB64`)
  }
  return event.bytesB64
}

function base64ToBytes(encoded: string): Uint8Array {
  const binary = globalThis.atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
