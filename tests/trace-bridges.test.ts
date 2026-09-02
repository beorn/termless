/**
 * Tests for the Trace ⇄ io-Recording bridges (unterm phase A3, slice 1).
 *
 * Covers:
 *  - recordingFromTrace: header mapping, event mapping (type/at/bytes/order),
 *    the no-io-track throw (naming the tracks present)
 *  - traceFromRecording: round-trip equality, the control/mark/exit drop
 *    tally, the no-survivors throw (quoting the tally), extras passthrough,
 *    and the duration fallback chain
 *  - Recording (the deprecated alias on recording/recording.ts) and Trace are
 *    the same type, and createRecording is a transparent alias of createTrace
 */

import { describe, test, expect } from "vitest"
import { createTrace, createRecording, trackAuthority, micros } from "../src/recording/recording.ts"
import type { Command, Recording as DeprecatedRecordingAlias, Trace } from "../src/recording/recording.ts"
import { recordingFromTrace, traceFromRecording } from "../src/recording/trace-bridges.ts"
import type { Recording as IoRecording } from "../src/io/recording.ts"
import type { InputEvent, OutputEvent } from "../src/io/event.ts"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// ── Fixtures ─────────────────────────────────────────────────────────────────

function sampleTrace(): Trace {
  return createTrace({
    cols: 80,
    rows: 24,
    durationMicros: micros(20_000),
    io: [
      { at: micros(0), direction: "in", data: "écho hî\r" },
      { at: micros(5_000), direction: "out", data: "hî\r\n$ 🎉" },
    ],
  })
}

/** An io Recording carrying one of every Event type. */
function recordingWithEveryEventType(): IoRecording {
  return {
    header: { version: 1, size: { cols: 80, rows: 24 }, duration: micros(9_000) },
    events: [
      { at: micros(0), type: "output", data: encoder.encode("hi") },
      { at: micros(1_000), type: "input", data: encoder.encode("go") },
      { at: micros(2_000), type: "control", control: "resize", size: { cols: 100, rows: 30 } },
      { at: micros(3_000), type: "mark", name: "turn-1" },
      { at: micros(4_000), type: "exit", code: 0, signal: null },
    ],
  }
}

// ── recordingFromTrace ───────────────────────────────────────────────────────

describe("recordingFromTrace", () => {
  test("maps header: size, duration, sourceResolution 'us'", () => {
    const rec = recordingFromTrace(sampleTrace())
    expect(rec.header).toEqual({
      version: 1,
      size: { cols: 80, rows: 24 },
      duration: micros(20_000),
      sourceResolution: "us",
    })
  })

  test("maps io rows to output/input events with encoded bytes, in stored order", () => {
    const rec = recordingFromTrace(sampleTrace())
    expect(rec.events).toHaveLength(2)
    const [first, second] = rec.events as [InputEvent, OutputEvent]

    expect(first.type).toBe("input")
    expect(first.at).toBe(micros(0))
    expect(decoder.decode(first.data)).toBe("écho hî\r")

    expect(second.type).toBe("output")
    expect(second.at).toBe(micros(5_000))
    expect(decoder.decode(second.data)).toBe("hî\r\n$ 🎉")
  })

  test("throws, naming the tracks present, when the Trace has no io track", () => {
    const trace = createTrace({
      cols: 80,
      rows: 24,
      durationMicros: micros(1_000_000),
      commands: [{ kind: "key", at: micros(0), key: "Enter" }],
    })
    expect(() => recordingFromTrace(trace)).toThrow(/no io track.*commands/)
  })
})

// ── traceFromRecording ───────────────────────────────────────────────────────

describe("traceFromRecording", () => {
  test("round-trips recordingFromTrace's output back to the original io rows, with a zero drop tally", () => {
    const trace = sampleTrace()
    const rec = recordingFromTrace(trace)
    const { trace: roundTripped, dropped } = traceFromRecording(rec)

    expect(dropped).toEqual({ control: 0, mark: 0, exit: 0 })
    expect(roundTripped.io).toEqual(trace.io)
    expect(roundTripped.cols).toBe(trace.cols)
    expect(roundTripped.rows).toBe(trace.rows)
    expect(roundTripped.durationMicros).toBe(trace.durationMicros)
  })

  test("tallies control/mark/exit as dropped and keeps output/input as the io track", () => {
    const { trace, dropped } = traceFromRecording(recordingWithEveryEventType())
    expect(dropped).toEqual({ control: 1, mark: 1, exit: 1 })
    expect(trace.io).toEqual([
      { at: micros(0), direction: "out", data: "hi" },
      { at: micros(1_000), direction: "in", data: "go" },
    ])
  })

  test("throws, quoting the tally, when no output/input event survives conversion", () => {
    const recording: IoRecording = {
      header: { version: 1, size: { cols: 80, rows: 24 } },
      events: [
        { at: micros(0), type: "control", control: "signal", signal: "SIGWINCH" },
        { at: micros(1_000), type: "mark" },
        { at: micros(2_000), type: "mark" },
        { at: micros(3_000), type: "exit", code: null, signal: "SIGTERM" },
      ],
    }
    expect(() => traceFromRecording(recording)).toThrow(/control=1, mark=2, exit=1/)
  })

  test("attaches extras (commands, provenance) alongside the built io track", () => {
    const commands: Command[] = [{ kind: "key", at: micros(0), key: "Enter" }]
    const { trace } = traceFromRecording(recordingWithEveryEventType(), {
      commands,
      provenance: { reproducible: false },
    })
    expect(trace.commands).toEqual(commands)
    expect(trace.provenance).toEqual({ reproducible: false })
  })

  test("prefers the header's duration; falls back to the last event's `at` when absent", () => {
    const withDuration = recordingWithEveryEventType() // header.duration = micros(9_000)
    expect(traceFromRecording(withDuration).trace.durationMicros).toBe(micros(9_000))

    const withoutDuration: IoRecording = {
      header: { version: 1, size: { cols: 80, rows: 24 } },
      events: [
        { at: micros(0), type: "output", data: encoder.encode("a") },
        { at: micros(7_000), type: "input", data: encoder.encode("b") },
      ],
    }
    expect(traceFromRecording(withoutDuration).trace.durationMicros).toBe(micros(7_000))
  })
})

// ── Recording (deprecated alias) and Trace are the same type ────────────────

describe("the deprecated Recording alias and Trace", () => {
  test("are mutually assignable, and createRecording is a transparent alias of createTrace", () => {
    const viaOld: DeprecatedRecordingAlias = createRecording({
      cols: 80,
      rows: 24,
      durationMicros: micros(1_000),
      io: [{ at: micros(0), direction: "out", data: "x" }],
    })
    // Compiles iff `Recording` and `Trace` are the same type in both directions.
    const viaNew: Trace = viaOld
    const backAgain: DeprecatedRecordingAlias = viaNew

    expect(viaOld).toEqual(viaNew)
    expect(backAgain).toEqual(viaOld)
    expect(trackAuthority(viaOld)).toEqual({ observation: "io", intent: null })
  })

  test("createRecording and createTrace throw the identical message on an empty input", () => {
    let fromOld: string | undefined
    let fromNew: string | undefined
    try {
      createRecording({ cols: 80, rows: 24, durationMicros: micros(0) })
    } catch (e) {
      fromOld = (e as Error).message
    }
    try {
      createTrace({ cols: 80, rows: 24, durationMicros: micros(0) })
    } catch (e) {
      fromNew = (e as Error).message
    }
    expect(fromOld).toBe(fromNew)
    expect(fromOld).toMatch(/at least one non-empty track/)
  })
})
