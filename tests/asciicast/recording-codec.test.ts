/**
 * `.cast` ⇄ `Recording` codec tests.
 *
 * Phase 2 of the Recording-domain unification — proves the in-memory
 * `Recording` can represent a `.cast` via the direction-tagged `io` track.
 * `.cast` is the one *symmetric* codec (unlike `.tape`): the round-trip is
 * lossless on the io track.
 */

import { describe, test, expect } from "vitest"
import { parseAsciicast } from "../../src/recording/asciicast/reader.ts"
import {
  decodeAsciicast,
  decodeAsciicastSource,
  encodeAsciicast,
} from "../../src/recording/asciicast/recording-codec.ts"
import { createRecording, micros, secondsToMicros } from "../../src/recording/recording.ts"

const CAST =
  [
    JSON.stringify({ version: 2, width: 100, height: 30, duration: 2.5, title: "demo" }),
    JSON.stringify([0.0, "o", "$ "]),
    JSON.stringify([0.5, "i", "ls\r"]),
    JSON.stringify([0.512, "o", "ls\r\n"]),
    JSON.stringify([1.0, "o", "file1  file2\r\n$ "]),
    JSON.stringify([1.2, "m", "a marker"]),
  ].join("\n") + "\n"

describe("decodeAsciicast — .cast → Recording (io track)", () => {
  test("decodes events into a direction-tagged io track", () => {
    const recording = decodeAsciicastSource(CAST)
    expect(recording.io).toBeDefined()
    expect(recording.io!.map((e) => e.direction)).toEqual(["out", "in", "out", "out"])
    // commands / frames absent — a decoded .cast is observed-truth only.
    expect(recording.commands).toBeUndefined()
    expect(recording.frames).toBeUndefined()
  })

  test("seeds dimensions from the header", () => {
    const recording = decodeAsciicastSource(CAST)
    expect(recording.cols).toBe(100)
    expect(recording.rows).toBe(30)
  })

  test("normalizes float-second timestamps to integer µs", () => {
    const recording = decodeAsciicastSource(CAST)
    expect(recording.io![0]!.at).toBe(0)
    expect(recording.io![1]!.at).toBe(500_000)
    expect(recording.io![2]!.at).toBe(512_000)
    for (const e of recording.io!) expect(Number.isInteger(e.at)).toBe(true)
  })

  test("drops marker events — they carry no io bytes", () => {
    const recording = decodeAsciicastSource(CAST)
    expect(recording.io!.some((e) => e.data === "a marker")).toBe(false)
    expect(recording.io!).toHaveLength(4)
  })

  test("uses header duration when present", () => {
    const recording = decodeAsciicastSource(CAST)
    expect(recording.durationMicros).toBe(secondsToMicros(2.5))
  })
})

describe("encodeAsciicast — Recording → .cast", () => {
  test("round-trips a .cast through Recording losslessly on the io track", () => {
    const original = parseAsciicast(CAST)
    const recording = decodeAsciicast(original)
    const reEncoded = encodeAsciicast(recording, { title: "demo" })
    const reParsed = parseAsciicast(reEncoded)

    // Header survives.
    expect(reParsed.header.width).toBe(100)
    expect(reParsed.header.height).toBe(30)
    // Every non-marker event survives byte-for-byte, with timestamps intact.
    const nonMarker = original.events.filter((e) => e.type !== "m")
    expect(reParsed.events).toHaveLength(nonMarker.length)
    for (let i = 0; i < nonMarker.length; i++) {
      expect(reParsed.events[i]!.type).toBe(nonMarker[i]!.type)
      expect(reParsed.events[i]!.data).toBe(nonMarker[i]!.data)
      expect(reParsed.events[i]!.time).toBeCloseTo(nonMarker[i]!.time, 5)
    }
  })

  test("throws for a recording with no io track", () => {
    const commandsOnly = createRecording({
      cols: 80,
      rows: 24,
      durationMicros: micros(0),
      commands: [{ kind: "sleep", at: micros(0), durationMicros: micros(0) }],
    })
    expect(() => encodeAsciicast(commandsOnly)).toThrow(/no io track/)
  })
})
