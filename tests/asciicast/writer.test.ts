/**
 * Tests for asciicast v2 writer.
 *
 * Verifies recording-to-asciicast conversion, JSON-lines format,
 * timestamp conversion, control character escaping, and round-trip.
 */

import { describe, test, expect } from "vitest"
import { toAsciicast, createAsciicastWriter } from "../../src/asciicast/writer.ts"
import { parseAsciicast } from "../../src/asciicast/reader.ts"
import type { Recording } from "../../src/recording.ts"

// =============================================================================
// toAsciicast
// =============================================================================

describe("toAsciicast", () => {
  test("converts a termless recording to asciicast v2 format", () => {
    const recording: Recording = {
      version: 1,
      cols: 80,
      rows: 24,
      duration: 2000,
      events: [
        { timestamp: 0, type: "output", data: "$ " },
        { timestamp: 500, type: "input", data: "ls\n" },
        { timestamp: 1000, type: "output", data: "file1  file2\r\n" },
      ],
    }

    const result = toAsciicast(recording)
    const lines = result.trim().split("\n")

    expect(lines).toHaveLength(4) // header + 3 events

    // Header
    const header = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(header.version).toBe(2)
    expect(header.width).toBe(80)
    expect(header.height).toBe(24)
    expect(header.duration).toBe(2)

    // Events — timestamps in seconds
    expect(JSON.parse(lines[1]!)).toEqual([0, "o", "$ "])
    expect(JSON.parse(lines[2]!)).toEqual([0.5, "i", "ls\n"])
    expect(JSON.parse(lines[3]!)).toEqual([1, "o", "file1  file2\r\n"])
  })

  test("includes title when provided", () => {
    const recording: Recording = {
      version: 1,
      cols: 80,
      rows: 24,
      duration: 0,
      events: [],
    }

    const result = toAsciicast(recording, { title: "My Session" })
    const header = JSON.parse(result.trim().split("\n")[0]!) as Record<string, unknown>
    expect(header.title).toBe("My Session")
  })

  test("output is valid JSON-lines", () => {
    const recording: Recording = {
      version: 1,
      cols: 120,
      rows: 40,
      duration: 1500,
      events: [
        { timestamp: 0, type: "output", data: "hello" },
        { timestamp: 750, type: "output", data: "world" },
        { timestamp: 1500, type: "output", data: "!" },
      ],
    }

    const result = toAsciicast(recording)
    const lines = result.trim().split("\n")

    // Every line should be valid JSON
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })

  test("properly escapes control characters in data", () => {
    const recording: Recording = {
      version: 1,
      cols: 80,
      rows: 24,
      duration: 100,
      events: [{ timestamp: 0, type: "output", data: "\x1b[31mred\x1b[0m\t\nnewline" }],
    }

    const result = toAsciicast(recording)
    const lines = result.trim().split("\n")
    const event = JSON.parse(lines[1]!) as [number, string, string]

    // JSON.parse should restore the original control characters
    expect(event[2]).toBe("\x1b[31mred\x1b[0m\t\nnewline")
  })

  test("round-trip: write → parse → compare", () => {
    const recording: Recording = {
      version: 1,
      cols: 80,
      rows: 24,
      duration: 2000,
      events: [
        { timestamp: 0, type: "output", data: "$ " },
        { timestamp: 200, type: "input", data: "echo hello\n" },
        { timestamp: 500, type: "output", data: "hello\r\n$ " },
        { timestamp: 1000, type: "output", data: "\x1b[31mred\x1b[0m" },
      ],
    }

    const asciicastStr = toAsciicast(recording, { title: "test" })
    const parsed = parseAsciicast(asciicastStr)

    expect(parsed.header.version).toBe(2)
    expect(parsed.header.width).toBe(80)
    expect(parsed.header.height).toBe(24)
    expect(parsed.header.title).toBe("test")
    expect(parsed.events).toHaveLength(4)
    expect(parsed.events[0]!.data).toBe("$ ")
    expect(parsed.events[1]!.data).toBe("echo hello\n")
    expect(parsed.events[2]!.data).toBe("hello\r\n$ ")
    expect(parsed.events[3]!.data).toBe("\x1b[31mred\x1b[0m")
  })
})

// =============================================================================
// createAsciicastWriter
// =============================================================================

describe("createAsciicastWriter", () => {
  test("writes header and events as JSON-lines", () => {
    const writer = createAsciicastWriter({
      version: 2,
      width: 80,
      height: 24,
    })

    writer.writeOutput("$ ")
    writer.writeInput("ls\n")
    writer.writeMarker("prompt")

    const result = writer.close()
    const lines = result.trim().split("\n")

    expect(lines).toHaveLength(4) // header + 3 events

    const header = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(header.version).toBe(2)
    expect(header.width).toBe(80)

    // Events
    const e1 = JSON.parse(lines[1]!) as [number, string, string]
    expect(e1[1]).toBe("o")
    expect(e1[2]).toBe("$ ")

    const e2 = JSON.parse(lines[2]!) as [number, string, string]
    expect(e2[1]).toBe("i")
    expect(e2[2]).toBe("ls\n")

    const e3 = JSON.parse(lines[3]!) as [number, string, string]
    expect(e3[1]).toBe("m")
    expect(e3[2]).toBe("prompt")
  })

  test("auto-calculates timestamps relative to start", () => {
    const writer = createAsciicastWriter({
      version: 2,
      width: 80,
      height: 24,
    })

    writer.writeOutput("a")
    writer.writeOutput("b")

    const result = writer.close()
    const lines = result.trim().split("\n")

    const t1 = (JSON.parse(lines[1]!) as [number, string, string])[0]
    const t2 = (JSON.parse(lines[2]!) as [number, string, string])[0]

    // Timestamps should be non-negative and non-decreasing
    expect(t1).toBeGreaterThanOrEqual(0)
    expect(t2).toBeGreaterThanOrEqual(t1)
  })

  test("throws when writing after close", () => {
    const writer = createAsciicastWriter({
      version: 2,
      width: 80,
      height: 24,
    })

    writer.close()

    expect(() => writer.writeOutput("x")).toThrow("AsciicastWriter has been closed")
    expect(() => writer.writeInput("y")).toThrow("AsciicastWriter has been closed")
    expect(() => writer.writeMarker("z")).toThrow("AsciicastWriter has been closed")
  })

  test("throws when closing twice", () => {
    const writer = createAsciicastWriter({
      version: 2,
      width: 80,
      height: 24,
    })

    writer.close()
    expect(() => writer.close()).toThrow("AsciicastWriter has already been closed")
  })

  test("output is parseable by parseAsciicast", () => {
    const writer = createAsciicastWriter({
      version: 2,
      width: 100,
      height: 50,
      title: "writer test",
    })

    writer.writeOutput("Hello ")
    writer.writeOutput("World\r\n")
    writer.writeInput("q")

    const result = writer.close()
    const parsed = parseAsciicast(result)

    expect(parsed.header.version).toBe(2)
    expect(parsed.header.width).toBe(100)
    expect(parsed.header.height).toBe(50)
    expect(parsed.header.title).toBe("writer test")
    expect(parsed.events).toHaveLength(3)
    expect(parsed.events[0]!.type).toBe("o")
    expect(parsed.events[0]!.data).toBe("Hello ")
    expect(parsed.events[2]!.type).toBe("i")
    expect(parsed.events[2]!.data).toBe("q")
  })
})
