/**
 * trim / retime / filter — the io Recording transforms.
 *
 * One small synthetic Recording (seven events, one of every Event type)
 * anchors most of these: hand-computed arithmetic is only trustworthy when
 * the input is small enough to add up on paper.
 */

import { describe, expect, test } from "vitest"
import {
  byType,
  filter,
  micros,
  retime,
  trim,
  type Event,
  type Micros,
  type Recording,
  type RecordingHeader,
} from "../../src/io/index.ts"
import { bytes } from "./fixtures.ts"

const SIZE = { cols: 80, rows: 24 }

function header(duration?: number): RecordingHeader {
  return duration === undefined
    ? { version: 1, size: { ...SIZE } }
    : { version: 1, size: { ...SIZE }, duration: micros(duration) }
}

/**
 * Seven events, one of every {@link Event} type, at hand-friendly instants.
 * Gaps between them (µs): 0, 1000, 1500, 1500, 2000, 3000, 500.
 */
function sampleEvents(): Event[] {
  return [
    { at: micros(0), type: "control", control: "resize", size: { ...SIZE } },
    { at: micros(1_000), type: "output", data: bytes("hello") },
    { at: micros(2_500), type: "input", data: bytes("ls\r") },
    { at: micros(4_000), type: "mark", name: "prompt" },
    { at: micros(6_000), type: "output", data: bytes(" world") },
    { at: micros(9_000), type: "control", control: "signal", signal: "SIGWINCH" },
    { at: micros(9_500), type: "exit", code: 0, signal: null },
  ]
}

function recording(duration?: number): Recording {
  return { header: header(duration), events: sampleEvents() }
}

describe("trim", () => {
  test("does not mutate its input", () => {
    const rec = recording(10_000)
    const before = structuredClone(rec)
    trim(rec, { from: micros(2_500), to: micros(6_000) })
    expect(rec).toEqual(before)
  })

  test("keeps the inclusive window and shifts it to start at 0 — hand-computed", () => {
    const rec = recording(10_000)
    const result = trim(rec, { from: micros(2_500), to: micros(6_000) })
    expect(result.events.map((e) => e.at)).toEqual([0, 1_500, 3_500].map(micros))
    expect(result.events.map((e) => e.type)).toEqual(["input", "mark", "output"])
    // duration = min(to=6000, header.duration=10000) - from=2500
    expect(result.header.duration).toBe(micros(3_500))
  })

  test("from=0 with no window is an identity trim — same at values, same event references", () => {
    const rec = recording(10_000)
    const result = trim(rec, {})
    expect(result.events.map((e) => e.at)).toEqual(rec.events.map((e) => e.at))
    expect(result.header.duration).toBe(micros(10_000))
    result.events.forEach((e, i) => expect(e).toBe(rec.events[i]))
  })

  test("header duration absent falls back to the last event's at", () => {
    const rec = recording(undefined)
    const result = trim(rec, { from: micros(1_000) })
    // to defaults to lastAt (9500); duration = min(9500, 9500) - 1000
    expect(result.events).toHaveLength(6)
    expect(result.header.duration).toBe(micros(8_500))
  })

  test("a window with nothing in it produces zero events, not an error", () => {
    const rec = recording(10_000)
    const result = trim(rec, { from: micros(5_000), to: micros(5_000) })
    expect(result.events).toEqual([])
    expect(result.header.duration).toBe(micros(0))
  })

  test("a `to` beyond the recording's real end clamps the header duration down to it", () => {
    const rec = recording(10_000)
    const result = trim(rec, { to: micros(50_000) })
    expect(result.events).toHaveLength(7)
    expect(result.header.duration).toBe(micros(10_000))
  })

  test("an inverted window throws a RangeError naming both values", () => {
    const rec = recording(10_000)
    expect(() => trim(rec, { from: micros(5_000), to: micros(1_000) })).toThrow(RangeError)
    expect(() => trim(rec, { from: micros(5_000), to: micros(1_000) })).toThrow(/5000/)
    expect(() => trim(rec, { from: micros(5_000), to: micros(1_000) })).toThrow(/1000/)
  })

  test("a negative from throws a RangeError naming the value", () => {
    const rec = recording(10_000)
    // Bypass the micros() guard, the way a bad cast on deserialized data would:
    // trim must still catch it at its own boundary, not trust the brand.
    expect(() => trim(rec, { from: -5 as Micros })).toThrow(/-5/)
  })

  test("a negative to throws a RangeError naming the value", () => {
    const rec = recording(10_000)
    expect(() => trim(rec, { to: -1 as Micros })).toThrow(/-1/)
  })
})

describe("retime", () => {
  test("does not mutate its input", () => {
    const rec = recording(10_000)
    const before = structuredClone(rec)
    retime(rec, { speed: 2 })
    expect(rec).toEqual(before)
  })

  test("speed=1 with no maxGap is an identity retime — same at values, same event references", () => {
    const rec = recording(10_000)
    const result = retime(rec)
    expect(result.events.map((e) => e.at)).toEqual(rec.events.map((e) => e.at))
    expect(result.header.duration).toBe(micros(10_000))
    result.events.forEach((e, i) => expect(e).toBe(rec.events[i]))
  })

  test("speed 2 halves every gap and the tail — hand-computed", () => {
    const rec = recording(10_000)
    const result = retime(rec, { speed: 2 })
    // gaps 0,1000,1500,1500,2000,3000,500 (tail 500) halved: 0,500,750,750,1000,1500,250 (tail 250)
    expect(result.events.map((e) => e.at)).toEqual([0, 500, 1_250, 2_000, 3_000, 4_500, 4_750].map(micros))
    expect(result.header.duration).toBe(micros(5_000))
  })

  test("maxGap caps a gap before it is divided — hand-computed", () => {
    const rec = recording(10_000)
    const result = retime(rec, { maxGap: micros(1_000) })
    // gaps capped at 1000: 0,1000,1000,1000,1000,1000,500 (tail 500), speed 1
    expect(result.events.map((e) => e.at)).toEqual([0, 1_000, 2_000, 3_000, 4_000, 5_000, 5_500].map(micros))
    expect(result.header.duration).toBe(micros(6_000))
  })

  test("maxGap and speed compose — cap first, then divide — hand-computed", () => {
    const rec = recording(10_000)
    const result = retime(rec, { speed: 2, maxGap: micros(1_000) })
    // capped gaps 0,1000,1000,1000,1000,1000,500 (tail 500) halved: 0,500,500,500,500,500,250 (tail 250)
    expect(result.events.map((e) => e.at)).toEqual([0, 500, 1_000, 1_500, 2_000, 2_500, 2_750].map(micros))
    expect(result.header.duration).toBe(micros(3_000))
  })

  test("a non-positive speed throws a RangeError naming the value", () => {
    const rec = recording(10_000)
    for (const speed of [0, -1, -0.5]) {
      expect(() => retime(rec, { speed })).toThrow(RangeError)
      expect(() => retime(rec, { speed })).toThrow(String(speed))
    }
  })

  test("header duration absent stays absent — retime never fabricates a bound", () => {
    const rec = recording(undefined)
    const result = retime(rec, { speed: 2 })
    expect(result.header.duration).toBeUndefined()
    expect(result.events.map((e) => e.at)).toEqual([0, 500, 1_250, 2_000, 3_000, 4_500, 4_750].map(micros))
  })
})

describe("filter", () => {
  test("does not mutate its input", () => {
    const rec = recording(10_000)
    const before = structuredClone(rec)
    filter(rec, (e) => e.type === "output")
    expect(rec).toEqual(before)
  })

  test("keeps only the events the predicate returns true for", () => {
    const rec = recording(10_000)
    const result = filter(rec, (e) => e.type === "output")
    expect(result.events.map((e) => e.type)).toEqual(["output", "output"])
  })

  test("header is copied unchanged — filtering removes rows, it never re-times", () => {
    const rec = recording(10_000)
    const result = filter(rec, (e) => e.type === "mark")
    expect(result.header).toEqual(rec.header)
    expect(result.header).not.toBe(rec.header)
  })

  test("byType keeps events matching any of the given discriminants", () => {
    const rec = recording(10_000)
    const result = filter(rec, byType("mark", "exit"))
    expect(result.events.map((e) => e.type)).toEqual(["mark", "exit"])
  })

  test("byType is typed against Event['type'] — a misspelled type is a compile error", () => {
    // @ts-expect-error "outptu" is not a member of Event["type"]
    const bad = byType("outptu")
    expect(typeof bad).toBe("function")
  })
})

describe("composition", () => {
  test("retime(trim(...)) composes — trim's window first, then retime's speed", () => {
    const rec = recording(10_000)
    const trimmed = trim(rec, { from: micros(1_000), to: micros(9_000) })
    // trimmed at's: 0,1500,3000,5000,8000; duration = min(9000,10000)-1000 = 8000
    const result = retime(trimmed, { speed: 2 })
    // gaps on the trimmed timeline: 0,1500,1500,2000,3000 (tail 8000-8000=0), halved
    expect(result.events.map((e) => e.at)).toEqual([0, 750, 1_500, 2_500, 4_000].map(micros))
    expect(result.header.duration).toBe(micros(4_000))
  })
})
