/**
 * Tests for asciicast v2 parser.
 *
 * Verifies parsing of headers, events, control characters,
 * line ending handling, and version validation.
 */

import { describe, test, expect } from "vitest"
import { parseAsciicast } from "../../src/asciicast/reader.ts"

describe("parseAsciicast", () => {
  test("parses a simple asciicast v2 file", () => {
    const content = [
      '{"version": 2, "width": 80, "height": 24}',
      '[0.5, "o", "$ "]',
      '[0.8, "o", "hello"]',
      '[1.0, "o", "\\r\\n"]',
    ].join("\n")

    const recording = parseAsciicast(content)

    expect(recording.header.version).toBe(2)
    expect(recording.header.width).toBe(80)
    expect(recording.header.height).toBe(24)
    expect(recording.events).toHaveLength(3)
    expect(recording.events[0]).toEqual({ time: 0.5, type: "o", data: "$ " })
    expect(recording.events[1]).toEqual({ time: 0.8, type: "o", data: "hello" })
    expect(recording.events[2]).toEqual({ time: 1.0, type: "o", data: "\r\n" })
  })

  test("parses all optional header fields", () => {
    const header = {
      version: 2,
      width: 120,
      height: 40,
      timestamp: 1234567890,
      duration: 42.5,
      title: "My Recording",
      env: { SHELL: "/bin/bash", TERM: "xterm-256color" },
      theme: {
        fg: "#ffffff",
        bg: "#000000",
        palette: "#000:#800:#080:#880:#008:#808:#088:#ccc:#888:#f00:#0f0:#ff0:#00f:#f0f:#0ff:#fff",
      },
    }

    const content = JSON.stringify(header) + "\n"
    const recording = parseAsciicast(content)

    expect(recording.header.version).toBe(2)
    expect(recording.header.width).toBe(120)
    expect(recording.header.height).toBe(40)
    expect(recording.header.timestamp).toBe(1234567890)
    expect(recording.header.duration).toBe(42.5)
    expect(recording.header.title).toBe("My Recording")
    expect(recording.header.env).toEqual({ SHELL: "/bin/bash", TERM: "xterm-256color" })
    expect(recording.header.theme?.fg).toBe("#ffffff")
    expect(recording.header.theme?.bg).toBe("#000000")
    expect(recording.header.theme?.palette).toContain("#000:")
  })

  test("handles empty events (header only)", () => {
    const content = '{"version": 2, "width": 80, "height": 24}\n'
    const recording = parseAsciicast(content)

    expect(recording.header.version).toBe(2)
    expect(recording.events).toHaveLength(0)
  })

  test("parses events with ANSI escape sequences", () => {
    const content = [
      '{"version": 2, "width": 80, "height": 24}',
      '[0.1, "o", "\\u001b[31mred\\u001b[0m"]',
      '[0.2, "o", "\\u001b[1;32mbold green\\u001b[0m"]',
    ].join("\n")

    const recording = parseAsciicast(content)

    expect(recording.events).toHaveLength(2)
    expect(recording.events[0]!.data).toBe("\x1b[31mred\x1b[0m")
    expect(recording.events[1]!.data).toBe("\x1b[1;32mbold green\x1b[0m")
  })

  test("parses input and marker events", () => {
    const content = [
      '{"version": 2, "width": 80, "height": 24}',
      '[0.5, "o", "$ "]',
      '[1.0, "i", "ls\\n"]',
      '[1.5, "m", "chapter-1"]',
      '[2.0, "o", "file1  file2\\r\\n"]',
    ].join("\n")

    const recording = parseAsciicast(content)

    expect(recording.events).toHaveLength(4)
    expect(recording.events[0]).toEqual({ time: 0.5, type: "o", data: "$ " })
    expect(recording.events[1]).toEqual({ time: 1.0, type: "i", data: "ls\n" })
    expect(recording.events[2]).toEqual({ time: 1.5, type: "m", data: "chapter-1" })
    expect(recording.events[3]).toEqual({ time: 2.0, type: "o", data: "file1  file2\r\n" })
  })

  test("handles \\r\\n line endings", () => {
    const content = '{"version": 2, "width": 80, "height": 24}\r\n[0.5, "o", "hello"]\r\n'

    const recording = parseAsciicast(content)

    expect(recording.header.version).toBe(2)
    expect(recording.events).toHaveLength(1)
    expect(recording.events[0]).toEqual({ time: 0.5, type: "o", data: "hello" })
  })

  test("rejects version 1 files", () => {
    const content = JSON.stringify({ version: 1, width: 80, height: 24 })
    expect(() => parseAsciicast(content)).toThrow("Unsupported asciicast version: 1")
  })

  test("rejects empty content", () => {
    expect(() => parseAsciicast("")).toThrow("Empty asciicast file")
    expect(() => parseAsciicast("  \n  \n  ")).toThrow("Empty asciicast file")
  })

  test("rejects invalid event format", () => {
    const content = ['{"version": 2, "width": 80, "height": 24}', '"not an array"'].join("\n")

    expect(() => parseAsciicast(content)).toThrow("Invalid event at line 2")
  })

  test("handles trailing newline", () => {
    const content = '{"version": 2, "width": 80, "height": 24}\n[0.0, "o", "x"]\n'
    const recording = parseAsciicast(content)

    expect(recording.events).toHaveLength(1)
  })

  test("handles multiple trailing newlines", () => {
    const content = '{"version": 2, "width": 80, "height": 24}\n[0.0, "o", "x"]\n\n\n'
    const recording = parseAsciicast(content)

    expect(recording.events).toHaveLength(1)
  })
})
