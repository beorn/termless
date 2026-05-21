/**
 * Tests for the in-memory Recording model (Phase 1 of the Recording-domain
 * unification — see hub/termless/recording-domain-model.md §3).
 *
 * Covers:
 *  - construction with every non-empty subset of tracks (empty rejected)
 *  - the integer-µs timebase invariant — no float timestamp survives import
 *  - direction tags on io events
 *  - the track-authority accessor
 */

import { describe, test, expect } from "vitest"
import { createRecording, trackAuthority, micros, secondsToMicros, millisToMicros } from "../src/recording/recording.ts"
import type { Command, Frame, IoEvent, Recording, RendererFingerprint } from "../src/recording/recording.ts"

// ── Fixtures ─────────────────────────────────────────────────────────────────

const fingerprint: RendererFingerprint = {
  backend: "ghostty",
  fontFamily: "Iosevka",
  fontSize: 14,
  cellSize: { width: 8, height: 17 },
  dpr: 2,
  theme: "dracula",
}

function sampleCommands(): Command[] {
  return [
    { kind: "type", at: micros(0), text: "echo hi" },
    { kind: "key", at: micros(500_000), key: "Enter" },
    { kind: "sleep", at: micros(600_000), durationMicros: micros(1_000_000) },
  ]
}

function sampleIo(): IoEvent[] {
  return [
    { at: micros(0), direction: "in", data: "echo hi\r" },
    { at: micros(10_000), direction: "out", data: "hi\r\n$ " },
  ]
}

function sampleFrames(): Frame[] {
  return [
    {
      seq: 1,
      at: micros(10_000),
      contentHash: "xxh64:abc",
      duplicateOf: null,
      fingerprint,
      buffer: { cols: 80, rows: 24, cursor: { row: 1, col: 2 } },
      ansiPreview: "hi",
      bytesInSinceLast: 7,
      png: "frames/00001.png",
    },
  ]
}

// ── Construction: non-empty-subset invariant ─────────────────────────────────

describe("createRecording — track subsets", () => {
  test("rejects an empty recording (no tracks at all)", () => {
    expect(() => createRecording({ cols: 80, rows: 24, durationMicros: micros(0) })).toThrow(
      /at least one non-empty track/,
    )
  })

  test("rejects a recording whose only track is an empty array", () => {
    expect(() => createRecording({ cols: 80, rows: 24, durationMicros: micros(0), commands: [], io: [] })).toThrow(
      /at least one non-empty track/,
    )
  })

  test("commands-only — a hand-authored tape", () => {
    const rec = createRecording({
      cols: 80,
      rows: 24,
      durationMicros: micros(1_600_000),
      commands: sampleCommands(),
    })
    expect(rec.commands).toHaveLength(3)
    expect(rec.io).toBeUndefined()
    expect(rec.frames).toBeUndefined()
  })

  test("io-only — a decoded .cast", () => {
    const rec = createRecording({
      cols: 80,
      rows: 24,
      durationMicros: micros(10_000),
      io: sampleIo(),
    })
    expect(rec.io).toHaveLength(2)
    expect(rec.commands).toBeUndefined()
    expect(rec.frames).toBeUndefined()
  })

  test("all three — a trace", () => {
    const rec = createRecording({
      cols: 80,
      rows: 24,
      durationMicros: micros(1_600_000),
      commands: sampleCommands(),
      io: sampleIo(),
      frames: sampleFrames(),
    })
    expect(rec.commands).toHaveLength(3)
    expect(rec.io).toHaveLength(2)
    expect(rec.frames).toHaveLength(1)
  })

  test("provenance defaults to reproducible; can be overridden", () => {
    const def = createRecording({
      cols: 80,
      rows: 24,
      durationMicros: micros(10_000),
      io: sampleIo(),
    })
    expect(def.provenance).toEqual({ reproducible: true })

    const nonRepro = createRecording({
      cols: 80,
      rows: 24,
      durationMicros: micros(10_000),
      frames: sampleFrames(),
      provenance: { reproducible: false },
    })
    expect(nonRepro.provenance.reproducible).toBe(false)
  })
})

// ── Integer-µs timebase invariant ────────────────────────────────────────────

describe("timebase — integer microseconds", () => {
  test("micros() rejects a float", () => {
    expect(() => micros(1.5)).toThrow(/integer microseconds/)
  })

  test("micros() rejects a negative value", () => {
    expect(() => micros(-1)).toThrow(/non-negative/)
  })

  test("micros() accepts a non-negative integer", () => {
    expect(micros(0)).toBe(0)
    expect(micros(1_234_567)).toBe(1_234_567)
  })

  test("secondsToMicros normalizes asciicast float seconds to integer µs", () => {
    // asciicast v2 records time as a float in seconds.
    const t = secondsToMicros(1.234567)
    expect(t).toBe(1_234_567)
    expect(Number.isInteger(t)).toBe(true)
  })

  test("secondsToMicros rounds — no float survives", () => {
    // 0.0000004 s rounds to 0 µs, 0.0000006 s rounds to 1 µs.
    expect(secondsToMicros(0.0000004)).toBe(0)
    expect(secondsToMicros(0.0000006)).toBe(1)
  })

  test("millisToMicros normalizes legacy ms timestamps to integer µs", () => {
    const t = millisToMicros(42.5)
    expect(t).toBe(42_500)
    expect(Number.isInteger(t)).toBe(true)
  })

  test("no float timestamp survives import of an asciicast-style event stream", () => {
    // Simulate importing asciicast float-second events into the io track.
    const asciicastEvents = [
      { time: 0.0, type: "o" as const, data: "$ " },
      { time: 0.512345, type: "i" as const, data: "ls\r" },
      { time: 1.999999, type: "o" as const, data: "file1\r\n" },
    ]
    const io: IoEvent[] = asciicastEvents.map((e) => ({
      at: secondsToMicros(e.time),
      direction: e.type === "i" ? "in" : "out",
      data: e.data,
    }))
    const rec = createRecording({
      cols: 80,
      rows: 24,
      durationMicros: secondsToMicros(1.999999),
      io,
    })
    // Every timestamp across the whole recording must be an integer.
    expect(Number.isInteger(rec.durationMicros)).toBe(true)
    for (const ev of rec.io ?? []) {
      expect(Number.isInteger(ev.at)).toBe(true)
    }
  })
})

// ── Direction tags on io events ──────────────────────────────────────────────

describe("io — direction tags", () => {
  test("every io event carries an in/out direction", () => {
    const rec = createRecording({
      cols: 80,
      rows: 24,
      durationMicros: micros(10_000),
      io: sampleIo(),
    })
    const directions = (rec.io ?? []).map((e) => e.direction)
    expect(directions).toEqual(["in", "out"])
    for (const d of directions) {
      expect(d === "in" || d === "out").toBe(true)
    }
  })
})

// ── Track-authority accessor ─────────────────────────────────────────────────

describe("trackAuthority", () => {
  test("io is the authoritative observation; commands the authoritative intent", () => {
    const rec = createRecording({
      cols: 80,
      rows: 24,
      durationMicros: micros(1_600_000),
      commands: sampleCommands(),
      io: sampleIo(),
    })
    expect(trackAuthority(rec)).toEqual({ observation: "io", intent: "commands" })
  })

  test("commands-only — no authoritative observation", () => {
    const rec = createRecording({
      cols: 80,
      rows: 24,
      durationMicros: micros(1_600_000),
      commands: sampleCommands(),
    })
    expect(trackAuthority(rec)).toEqual({ observation: null, intent: "commands" })
  })

  test("io-only — no authoritative intent", () => {
    const rec = createRecording({
      cols: 80,
      rows: 24,
      durationMicros: micros(10_000),
      io: sampleIo(),
    })
    expect(trackAuthority(rec)).toEqual({ observation: "io", intent: null })
  })

  test("frames-only — neither track is authoritative", () => {
    const rec: Recording = createRecording({
      cols: 80,
      rows: 24,
      durationMicros: micros(10_000),
      frames: sampleFrames(),
    })
    expect(trackAuthority(rec)).toEqual({ observation: null, intent: null })
  })
})
