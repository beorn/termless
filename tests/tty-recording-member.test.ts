/**
 * The `recording` member (D10, unterm A3 slice 5b part ii) — the write-new
 * io-shaped member of a `.tty`/`.ttyz` bundle: one {@link TtyEventRow} per
 * line, output/input bytes as base64 text. `writeRecording` gains the
 * io-Recording overload that writes it (`recording.jsonl`); the Trace
 * overload keeps writing `io.jsonl` exactly as before (proven byte-identical
 * by the existing suites — this file adds no new assertion on that, only on
 * the new door's own behavior). `loadBundle` reads a `recording` member
 * natively; `readBundle` (the deprecated Trace door) reads the same member
 * through `ioEventFromEvent`, tallying whatever it cannot place.
 *
 * Battery map:
 *  - round trip: an io Recording with all five Event kinds, through
 *    writeRecording -> loadRecording, both `.tty` and `.ttyz`
 *  - write-new (`recording` member) vs old-way (`io` member) of output/input
 *    -only events: loadRecording agrees event for event
 *  - readBundle on a `recording` bundle: output/input into `io`, the rest
 *    tallied under `skipped.recordingNonIo`
 *  - fail-loud: a malformed row throws naming the member and the line
 */
import { describe, expect, test } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadRecording, packRecording, readBundle, writeRecording } from "../src/recording/native/tty-format.ts"
import { createRecording, micros } from "../src/recording/recording.ts"
import type { Event } from "../src/io/event.ts"
import type { Recording as IoRecording, RecordingHeader as IoRecordingHeader } from "../src/io/recording.ts"

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "tty-recording-member-test-"))
}

const enc = new TextEncoder()

/** An io Recording exercising all five Event kinds (output/input/control×3/mark×2/exit), for the round-trip goldens. */
function fiveKindRecording(): IoRecording {
  const header: IoRecordingHeader = {
    version: 1,
    size: { cols: 100, rows: 30 },
    timestamp: 1_754_620_000_000,
    duration: micros(500_000),
    // "s" (asciicast-style) rather than "us"/"ms" so a passing test proves
    // the manifest's own declaration was honored on read, not a coincidence
    // with the sawHts1-inference fallback (which never produces "s").
    sourceResolution: "s",
  }
  const events: Event[] = [
    { at: micros(0), type: "output", data: enc.encode("hello") },
    { at: micros(50_000), type: "input", data: enc.encode("world") },
    { at: micros(100_000), type: "control", control: "resize", size: { cols: 100, rows: 30 } },
    { at: micros(150_000), type: "control", control: "resize", size: { cols: 120, rows: 40 }, derived: true },
    { at: micros(200_000), type: "control", control: "mode", mode: "altScreen", enabled: true },
    { at: micros(250_000), type: "control", control: "signal", signal: "SIGWINCH" },
    { at: micros(300_000), type: "mark", name: "boot" },
    { at: micros(350_000), type: "mark", derived: true },
    { at: micros(500_000), type: "exit", code: 0, signal: null },
  ]
  return { header, events }
}

describe("writeRecording (io-Recording overload) -> loadRecording — round trip", () => {
  test("an io Recording with all five event kinds round-trips through a .tty bundle", () => {
    const dir = tmp()
    try {
      const bundle = join(dir, "session.tty")
      const recording = fiveKindRecording()
      writeRecording(bundle, recording)
      const loaded = loadRecording(bundle)
      expect(loaded.events).toEqual(recording.events)
      expect(loaded.header).toEqual(recording.header)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("the same io Recording round-trips through .ttyz (packRecording)", () => {
    const dir = tmp()
    try {
      const bundle = join(dir, "session.tty")
      const recording = fiveKindRecording()
      writeRecording(bundle, recording)
      const sealed = join(dir, "session.ttyz")
      packRecording(bundle, sealed)
      const loaded = loadRecording(sealed)
      expect(loaded.events).toEqual(recording.events)
      expect(loaded.header).toEqual(recording.header)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("write-new vs old-way", () => {
  test("output/input-only events: a `recording` member and an `io` member agree event for event through loadRecording", () => {
    const dir = tmp()
    try {
      const oldWayBundle = join(dir, "old-way.tty")
      const traceRecording = createRecording({
        cols: 80,
        rows: 24,
        durationMicros: micros(500_000),
        io: [
          { at: micros(0), direction: "out", data: "hello" },
          { at: micros(100_000), direction: "in", data: "world" },
        ],
      })
      writeRecording(oldWayBundle, traceRecording)

      const newWayBundle = join(dir, "new-way.tty")
      const ioRecording: IoRecording = {
        header: { version: 1, size: { cols: 80, rows: 24 }, duration: micros(500_000), sourceResolution: "us" },
        events: [
          { at: micros(0), type: "output", data: enc.encode("hello") },
          { at: micros(100_000), type: "input", data: enc.encode("world") },
        ],
      }
      writeRecording(newWayBundle, ioRecording)

      const oldWayLoaded = loadRecording(oldWayBundle)
      const newWayLoaded = loadRecording(newWayBundle)
      expect(newWayLoaded.events).toEqual(oldWayLoaded.events)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("readBundle (deprecated Trace door) on a `recording` bundle", () => {
  test("output/input land in the io track; control/mark/exit are tallied under skipped.recordingNonIo", () => {
    const dir = tmp()
    try {
      const bundle = join(dir, "session.tty")
      const recording: IoRecording = {
        header: { version: 1, size: { cols: 80, rows: 24 }, sourceResolution: "us" },
        events: [
          { at: micros(0), type: "output", data: enc.encode("a") },
          { at: micros(100_000), type: "input", data: enc.encode("b") },
          { at: micros(200_000), type: "control", control: "resize", size: { cols: 100, rows: 30 } },
          { at: micros(300_000), type: "mark", name: "x" },
          { at: micros(400_000), type: "exit", code: 0, signal: null },
        ],
      }
      writeRecording(bundle, recording)

      const { recording: trace, skipped } = readBundle(bundle)
      expect(trace.io).toHaveLength(2)
      expect(trace.io?.[0]).toEqual({ at: 0, direction: "out", data: "a" })
      expect(trace.io?.[1]).toEqual({ at: 100_000, direction: "in", data: "b" })
      // resize + mark + exit: ioEventFromEvent has no io-track row for any of
      // them (the same gap its own docstring names) — one honest tally, not
      // folded into lifecycle/truncation, which they are not.
      expect(skipped.recordingNonIo).toBe(3)
      expect(skipped.lifecycle).toBe(0)
      expect(skipped.truncation).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("recording member — fail-loud", () => {
  test("a malformed row throws, naming the member and the 1-based line", () => {
    const dir = tmp()
    try {
      const bundle = join(dir, "session.tty")
      mkdirSync(bundle, { recursive: true })
      const goodRow = JSON.stringify({ at: 0, type: "output", data: "aGVsbG8=" })
      const badRow = "not json {{{"
      writeFileSync(join(bundle, "recording.jsonl"), `${goodRow}\n${badRow}\n`)
      const manifest = {
        ttyVersion: 1,
        recordingVersion: 1,
        cols: 80,
        rows: 24,
        durationMicros: 0,
        reproducible: true,
        members: [{ path: "recording.jsonl", type: "recording", encoding: "jsonl" }],
      }
      writeFileSync(join(bundle, "manifest.json"), JSON.stringify(manifest, null, 2))

      expect(() => loadRecording(bundle)).toThrow(/recording\.jsonl/)
      expect(() => loadRecording(bundle)).toThrow(/line 2/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("an output row without string `data` throws, naming the member and the line — not Buffer's own TypeError", () => {
    const dir = tmp()
    try {
      const bundle = join(dir, "session.tty")
      mkdirSync(bundle, { recursive: true })
      const bytelessRow = JSON.stringify({ at: 0, type: "output" })
      writeFileSync(join(bundle, "recording.jsonl"), `${bytelessRow}\n`)
      const manifest = {
        ttyVersion: 1,
        recordingVersion: 1,
        cols: 80,
        rows: 24,
        durationMicros: 0,
        reproducible: true,
        members: [{ path: "recording.jsonl", type: "recording", encoding: "jsonl" }],
      }
      writeFileSync(join(bundle, "manifest.json"), JSON.stringify(manifest, null, 2))

      expect(() => loadRecording(bundle)).toThrow(/recording\.jsonl/)
      expect(() => loadRecording(bundle)).toThrow(/line 1 is an output row without string "data"/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
