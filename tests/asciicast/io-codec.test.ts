/**
 * `readAsciicast`/`writeAsciicast` — the io-shaped `.cast` codec pair
 * (unterm phase A3, slice 4).
 *
 * The golden corpus (`./golden-roundtrip.test.ts`) proves this pair is
 * lossless across every committed fixture; this file targets the specific
 * mappings and edge cases a corpus sweep doesn't isolate — header field by
 * field, event type by event type, the two thrown-error shapes, the write
 * tally, and the documented non-UTF-8 lossiness — plus that the deprecated
 * `decodeAsciicast`/`encodeAsciicast` wrappers (`./recording-codec.ts`) are
 * genuinely thin: composing this pair with the Trace bridges by hand
 * reproduces them exactly.
 */
import { describe, test, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseAsciicast } from "../../src/recording/asciicast/reader.ts"
import { readAsciicast, writeAsciicast } from "../../src/recording/asciicast/io-codec.ts"
import { decodeAsciicast, encodeAsciicast } from "../../src/recording/asciicast/recording-codec.ts"
import { recordingFromTrace, traceFromRecording } from "../../src/recording/trace-bridges.ts"
import type { Recording } from "../../src/io/recording.ts"
import type { Event } from "../../src/io/event.ts"
import { micros } from "../../src/io/time.ts"

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures")
const readFixture = (name: string): string => readFileSync(join(FIXTURES_DIR, name), "utf8")

const encoder = new TextEncoder()

/** Build a minimal io Recording from a plain event list, for write-side tests. */
function recordingOf(events: Event[]): Recording {
  return { header: { version: 1, size: { cols: 80, rows: 24 } }, events }
}

describe("readAsciicast — header mapping", () => {
  test('width/height -> size, and sourceResolution is always "s"', () => {
    const io = readAsciicast('{"version":2,"width":80,"height":24}\n')
    expect(io.header.version).toBe(1)
    expect(io.header.size).toEqual({ cols: 80, rows: 24 })
    expect(io.header.sourceResolution).toBe("s")
  })

  test("timestamp/duration/title/env/theme all survive when present", () => {
    const text = readFixture("02-header-fields.cast")
    const io = readAsciicast(text)
    const parsed = parseAsciicast(text)
    expect(io.header.timestamp).toBe(parsed.header.timestamp)
    expect(io.header.duration).toBe(parsed.header.duration! * 1_000_000)
    expect(io.header.title).toBe(parsed.header.title)
    expect(io.header.env).toEqual(parsed.header.env)
    expect(io.header.theme).toEqual(parsed.header.theme)
  })

  test("absent optional header fields stay absent — no fabricated defaults", () => {
    const io = readAsciicast('{"version":2,"width":80,"height":24}\n[0,"o","x"]\n')
    expect(io.header.timestamp).toBeUndefined()
    expect(io.header.duration).toBeUndefined()
    expect(io.header.title).toBeUndefined()
    expect(io.header.env).toBeUndefined()
    expect(io.header.theme).toBeUndefined()
  })
})

describe("readAsciicast — event mapping", () => {
  const HEADER = '{"version":2,"width":80,"height":24}'

  test('"o" -> output, UTF-8 encoded', () => {
    const io = readAsciicast([HEADER, '[0.25,"o","hi"]'].join("\n") + "\n")
    expect(io.events[0]).toEqual({ at: micros(250_000), type: "output", data: encoder.encode("hi") })
  })

  test('"i" -> input, UTF-8 encoded', () => {
    const io = readAsciicast([HEADER, '[0.25,"i","ls\\r"]'].join("\n") + "\n")
    expect(io.events[0]).toEqual({ at: micros(250_000), type: "input", data: encoder.encode("ls\r") })
  })

  test('"m" with a non-empty label -> mark with name set', () => {
    const io = readAsciicast([HEADER, '[1,"m","chapter-1"]'].join("\n") + "\n")
    expect(io.events[0]).toEqual({ at: micros(1_000_000), type: "mark", name: "chapter-1" })
  })

  test('"m" with an empty label -> mark with name omitted, not name: ""', () => {
    const io = readAsciicast([HEADER, '[1,"m",""]'].join("\n") + "\n")
    expect(io.events[0]).toEqual({ at: micros(1_000_000), type: "mark" })
    expect(Object.prototype.hasOwnProperty.call(io.events[0]!, "name")).toBe(false)
  })

  test('"r" -> control/resize with size parsed from "COLSxROWS"', () => {
    const io = readAsciicast([HEADER, '[2,"r","100x30"]'].join("\n") + "\n")
    expect(io.events[0]).toEqual({
      at: micros(2_000_000),
      type: "control",
      control: "resize",
      size: { cols: 100, rows: 30 },
    })
    expect((io.events[0] as { derived?: true }).derived).toBeUndefined()
  })

  test("malformed resize data throws, naming the line and the value", () => {
    const text = [HEADER, '[2,"r","not-a-size"]'].join("\n") + "\n"
    expect(() => readAsciicast(text)).toThrow(/line 2/)
    expect(() => readAsciicast(text)).toThrow(/not-a-size/)
  })

  test("an unknown event code throws, naming the line and the code (bypassing parseAsciicast)", () => {
    const built = {
      header: { version: 2 as const, width: 80, height: 24 },
      events: [{ time: 0, type: "x", data: "?" } as unknown as { time: number; type: "o"; data: string }],
    }
    expect(() => readAsciicast(built)).toThrow(/line 2/)
    expect(() => readAsciicast(built)).toThrow(/"x"/)
  })

  test("accepts .cast text directly — equivalent to parsing it first", () => {
    const text = [HEADER, '[0,"o","a"]', '[1,"r","40x10"]'].join("\n") + "\n"
    expect(readAsciicast(text)).toEqual(readAsciicast(parseAsciicast(text)))
  })
})

describe("writeAsciicast — event mapping and drop tally", () => {
  test("output/input/mark/control-resize all survive with their asciicast codes", () => {
    const { text, dropped } = writeAsciicast(
      recordingOf([
        { at: micros(0), type: "output", data: encoder.encode("$ ") },
        { at: micros(100_000), type: "input", data: encoder.encode("ls\r") },
        { at: micros(200_000), type: "mark", name: "chapter-1" },
        { at: micros(300_000), type: "control", control: "resize", size: { cols: 100, rows: 30 } },
      ]),
    )
    const reParsed = parseAsciicast(text)
    expect(reParsed.events).toEqual([
      { time: 0, type: "o", data: "$ " },
      { time: 0.1, type: "i", data: "ls\r" },
      { time: 0.2, type: "m", data: "chapter-1" },
      { time: 0.3, type: "r", data: "100x30" },
    ])
    expect(dropped).toEqual({ mode: 0, signal: 0, exit: 0 })
  })

  test("a mark with no name writes an empty-string label, not a missing tuple element", () => {
    const { text } = writeAsciicast(recordingOf([{ at: micros(0), type: "mark" }]))
    expect(parseAsciicast(text).events[0]).toEqual({ time: 0, type: "m", data: "" })
  })

  test("mode/signal/exit have no asciicast v2 form and are tallied exactly, not emitted", () => {
    const { text, dropped } = writeAsciicast(
      recordingOf([
        { at: micros(0), type: "output", data: encoder.encode("kept") },
        { at: micros(100_000), type: "control", control: "mode", mode: "altScreen", enabled: true },
        { at: micros(200_000), type: "control", control: "mode", mode: "insertMode", enabled: false },
        { at: micros(300_000), type: "control", control: "signal", signal: "SIGWINCH" },
        { at: micros(400_000), type: "exit", code: 0, signal: null },
      ]),
    )
    expect(dropped).toEqual({ mode: 2, signal: 1, exit: 1 })
    // The one survivor is still there — dropping is per-event, not all-or-nothing.
    expect(parseAsciicast(text).events).toEqual([{ time: 0, type: "o", data: "kept" }])
  })

  test("a non-UTF-8 output byte is documented-lossy: each invalid byte becomes U+FFFD", () => {
    const { text } = writeAsciicast(
      recordingOf([{ at: micros(0), type: "output", data: new Uint8Array([0x24, 0xff, 0xfe, 0x24]) }]),
    )
    expect(parseAsciicast(text).events[0]!.data).toBe("$��$")
  })

  test("options override header title/timestamp; header values are the fallback", () => {
    const recording: Recording = {
      header: { version: 1, size: { cols: 80, rows: 24 }, title: "from-header", timestamp: 111 },
      events: [{ at: micros(0), type: "output", data: encoder.encode("x") }],
    }
    const withoutOptions = parseAsciicast(writeAsciicast(recording).text)
    expect(withoutOptions.header.title).toBe("from-header")
    expect(withoutOptions.header.timestamp).toBe(111)

    const withOptions = parseAsciicast(writeAsciicast(recording, { title: "override", timestamp: 222 }).text)
    expect(withOptions.header.title).toBe("override")
    expect(withOptions.header.timestamp).toBe(222)
  })

  test("duration: emitted only when header.duration is present — never fabricated", () => {
    const withHeaderDuration: Recording = {
      header: { version: 1, size: { cols: 80, rows: 24 }, duration: micros(5_000_000) },
      events: [{ at: micros(1_000_000), type: "output", data: encoder.encode("x") }],
    }
    expect(parseAsciicast(writeAsciicast(withHeaderDuration).text).header.duration).toBe(5)

    // No header.duration, despite a real last event to derive one from and a
    // Trace-shaped writer elsewhere in this package that would: this pair is
    // the symmetric .cast codec, so an unmeasured duration stays unmeasured.
    const withoutHeaderDuration = recordingOf([
      { at: micros(0), type: "output", data: encoder.encode("a") },
      { at: micros(2_500_000), type: "output", data: encoder.encode("b") },
    ])
    expect(parseAsciicast(writeAsciicast(withoutHeaderDuration).text).header.duration).toBeUndefined()

    expect(parseAsciicast(writeAsciicast(recordingOf([])).text).header.duration).toBeUndefined()
  })
})

describe("deprecated wrappers equal the new pair composed with the Trace bridges", () => {
  test.each(["02-header-fields.cast", "03-markers.cast"])("%s: decodeAsciicast", (name) => {
    const cast = parseAsciicast(readFixture(name))
    expect(decodeAsciicast(cast)).toEqual(traceFromRecording(readAsciicast(cast)).trace)
  })

  test.each(["02-header-fields.cast", "03-markers.cast"])("%s: encodeAsciicast", (name) => {
    const trace = decodeAsciicast(parseAsciicast(readFixture(name)))
    expect(encodeAsciicast(trace)).toBe(writeAsciicast(recordingFromTrace(trace)).text)
  })
})
