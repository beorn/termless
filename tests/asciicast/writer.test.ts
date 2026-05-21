/**
 * Tests for the asciicast v2 streaming writer.
 *
 * Verifies JSON-lines format, auto-timestamping, close semantics, and that
 * the output round-trips through `parseAsciicast`.
 */

import { describe, test, expect } from "vitest"
import { createAsciicastWriter } from "../../src/recording/asciicast/writer.ts"
import { parseAsciicast } from "../../src/recording/asciicast/reader.ts"

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
