/**
 * Tests for asciicast ↔ termless recording conversion.
 *
 * Verifies bidirectional conversion preserves event data,
 * handles edge cases, and round-trips correctly.
 */

import { describe, test, expect } from "vitest"
import { recordingToAsciicast, asciicastToRecording } from "../../src/asciicast/convert.ts"
import type { Recording } from "../../src/recording.ts"
import type { AsciicastRecording } from "../../src/asciicast/types.ts"

// =============================================================================
// recordingToAsciicast
// =============================================================================

describe("recordingToAsciicast", () => {
  test("converts termless recording to asciicast", () => {
    const recording: Recording = {
      version: 1,
      cols: 80,
      rows: 24,
      duration: 2000,
      events: [
        { timestamp: 0, type: "output", data: "$ " },
        { timestamp: 500, type: "input", data: "ls\n" },
        { timestamp: 1000, type: "output", data: "file1\r\n" },
      ],
    }

    const result = recordingToAsciicast(recording)

    expect(result.header.version).toBe(2)
    expect(result.header.width).toBe(80)
    expect(result.header.height).toBe(24)
    expect(result.header.duration).toBe(2)

    expect(result.events).toHaveLength(3)
    expect(result.events[0]).toEqual({ time: 0, type: "o", data: "$ " })
    expect(result.events[1]).toEqual({ time: 0.5, type: "i", data: "ls\n" })
    expect(result.events[2]).toEqual({ time: 1, type: "o", data: "file1\r\n" })
  })

  test("applies width/height overrides", () => {
    const recording: Recording = {
      version: 1,
      cols: 80,
      rows: 24,
      duration: 0,
      events: [],
    }

    const result = recordingToAsciicast(recording, { width: 120, height: 40 })

    expect(result.header.width).toBe(120)
    expect(result.header.height).toBe(40)
  })

  test("includes title when provided", () => {
    const recording: Recording = {
      version: 1,
      cols: 80,
      rows: 24,
      duration: 0,
      events: [],
    }

    const result = recordingToAsciicast(recording, { title: "My Session" })
    expect(result.header.title).toBe("My Session")
  })
})

// =============================================================================
// asciicastToRecording
// =============================================================================

describe("asciicastToRecording", () => {
  test("converts asciicast to termless recording", () => {
    const asciicast: AsciicastRecording = {
      header: { version: 2, width: 80, height: 24, duration: 2 },
      events: [
        { time: 0, type: "o", data: "$ " },
        { time: 0.5, type: "i", data: "ls\n" },
        { time: 1.0, type: "o", data: "file1\r\n" },
      ],
    }

    const result = asciicastToRecording(asciicast)

    expect(result.version).toBe(1)
    expect(result.cols).toBe(80)
    expect(result.rows).toBe(24)
    expect(result.duration).toBe(2000)

    expect(result.events).toHaveLength(3)
    expect(result.events[0]).toEqual({ timestamp: 0, type: "output", data: "$ " })
    expect(result.events[1]).toEqual({ timestamp: 500, type: "input", data: "ls\n" })
    expect(result.events[2]).toEqual({ timestamp: 1000, type: "output", data: "file1\r\n" })
  })

  test("drops marker events (no termless equivalent)", () => {
    const asciicast: AsciicastRecording = {
      header: { version: 2, width: 80, height: 24 },
      events: [
        { time: 0, type: "o", data: "hello" },
        { time: 0.5, type: "m", data: "chapter-1" },
        { time: 1.0, type: "o", data: "world" },
      ],
    }

    const result = asciicastToRecording(asciicast)

    expect(result.events).toHaveLength(2)
    expect(result.events[0]!.data).toBe("hello")
    expect(result.events[1]!.data).toBe("world")
  })

  test("infers duration from last event when header lacks it", () => {
    const asciicast: AsciicastRecording = {
      header: { version: 2, width: 80, height: 24 },
      events: [
        { time: 0, type: "o", data: "a" },
        { time: 1.5, type: "o", data: "b" },
      ],
    }

    const result = asciicastToRecording(asciicast)
    expect(result.duration).toBe(1500)
  })

  test("handles empty events", () => {
    const asciicast: AsciicastRecording = {
      header: { version: 2, width: 80, height: 24 },
      events: [],
    }

    const result = asciicastToRecording(asciicast)
    expect(result.duration).toBe(0)
    expect(result.events).toHaveLength(0)
  })
})

// =============================================================================
// Round-trip
// =============================================================================

describe("round-trip", () => {
  test("termless → asciicast → termless preserves event data", () => {
    const original: Recording = {
      version: 1,
      cols: 100,
      rows: 50,
      duration: 3000,
      events: [
        { timestamp: 0, type: "output", data: "$ " },
        { timestamp: 100, type: "input", data: "echo hello\n" },
        { timestamp: 500, type: "output", data: "hello\r\n" },
        { timestamp: 1000, type: "output", data: "\x1b[31mred\x1b[0m" },
        { timestamp: 2000, type: "output", data: "$ " },
      ],
    }

    const asciicast = recordingToAsciicast(original)
    const roundTripped = asciicastToRecording(asciicast)

    expect(roundTripped.version).toBe(1)
    expect(roundTripped.cols).toBe(original.cols)
    expect(roundTripped.rows).toBe(original.rows)
    expect(roundTripped.duration).toBe(original.duration)
    expect(roundTripped.events).toHaveLength(original.events.length)

    for (let i = 0; i < original.events.length; i++) {
      expect(roundTripped.events[i]!.timestamp).toBe(original.events[i]!.timestamp)
      expect(roundTripped.events[i]!.type).toBe(original.events[i]!.type)
      expect(roundTripped.events[i]!.data).toBe(original.events[i]!.data)
    }
  })

  test("asciicast → termless → asciicast preserves event data (excluding markers)", () => {
    const original: AsciicastRecording = {
      header: { version: 2, width: 80, height: 24, duration: 1.5 },
      events: [
        { time: 0, type: "o", data: "hello " },
        { time: 0.75, type: "i", data: "x" },
        { time: 1.5, type: "o", data: "world" },
      ],
    }

    const recording = asciicastToRecording(original)
    const roundTripped = recordingToAsciicast(recording)

    expect(roundTripped.header.width).toBe(original.header.width)
    expect(roundTripped.header.height).toBe(original.header.height)
    expect(roundTripped.header.duration).toBe(original.header.duration)
    expect(roundTripped.events).toHaveLength(original.events.length)

    for (let i = 0; i < original.events.length; i++) {
      expect(roundTripped.events[i]!.time).toBe(original.events[i]!.time)
      expect(roundTripped.events[i]!.type).toBe(original.events[i]!.type)
      expect(roundTripped.events[i]!.data).toBe(original.events[i]!.data)
    }
  })
})
