/**
 * `loadBundle` / `loadRecording` — the io-shaped `.tty`/`.ttyz` reader
 * (unterm phase A3, slice 5a). `readBundle`/`readRecording`
 * (tests/tty-format.test.ts) produce the Trace-shaped Recording; these
 * produce the io-shaped Recording (`Event[]`, raw bytes,
 * `@termless/core/io`) per docs/reference/formats/tty.md, "Loading as an io
 * Recording".
 *
 * Battery map:
 *  - jsonl bundle: matches recordingFromTrace(readRecording(dir)) event for
 *    event, modulo header.sourceResolution
 *  - hts1: raw payload bytes (the UTF-8-decode fossil the Trace door has and
 *    this door removes); a captured resize frame becomes a non-derived
 *    control/resize event (the Trace door reads the same frame into its
 *    commands track — both truths pinned); lifecycle/truncation frames are
 *    tallied, same as the Trace door
 *  - checkpoint members are NOT loaded in this slice — tallied by path, same
 *    as commands/frames/facts/habcp (their content contract is a later
 *    slice, against the real hab-side producer)
 *  - sourceResolution: "ms" when any loaded io member is hts1, "us"
 *    otherwise; a bundle with no io member at all throws "no events" (same
 *    as any other bundle with nothing this door loads)
 *  - the skip tally: commands/frames/facts/habcp/checkpoint member paths,
 *    never a silent drop
 *  - fail-loud: no events at all (commands-only, checkpoints-only)
 *  - encoding-blindness: .ttyz loads identically to its .tty bundle dir
 *  - duration/size fallbacks
 */
import { describe, expect, test } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  loadBundle,
  loadRecording,
  packRecording,
  readRecording,
  writeRecording,
} from "../src/recording/native/tty-format.ts"
import { recordingFromTrace } from "../src/recording/trace-bridges.ts"
import { createRecording, micros } from "../src/recording/recording.ts"
import type { Event } from "../src/io/event.ts"

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "tty-load-test-"))
}

// ── hts1 test encoder — hand-built per the format reference (BE u32s),
// adapted from tests/tty-format.test.ts's local helper (the fixture builder
// named in this slice's brief, tests/journal-replay.test.ts, builds a
// different, higher-level JSON journal shape — grepped, confirmed absent —
// so this is the actual reusable hts1 encoder). ──

type HtsHeader = {
  kind: "output" | "input" | "resize" | "lifecycle" | "truncation"
  offset: number
  at: number
  size?: { cols: number; rows: number }
  state?: string
  retainedFromOffset?: number
}

function htsFrame(header: HtsHeader, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header))
  const out = new Uint8Array(4 + 1 + 8 + headerBytes.length + payload.length)
  out.set([0x48, 0x54, 0x53, 0x31], 0) // "HTS1"
  out[4] = 1 // version
  const view = new DataView(out.buffer)
  view.setUint32(5, headerBytes.length, false)
  view.setUint32(9, payload.length, false)
  out.set(headerBytes, 13)
  out.set(payload, 13 + headerBytes.length)
  return out
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0
  for (const c of chunks) total += c.length
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

const text = (s: string) => new TextEncoder().encode(s)
const jsonl = (rows: unknown[]) => new TextEncoder().encode(rows.map((r) => JSON.stringify(r)).join("\n") + "\n")

const ORIGIN = 1_754_620_000_000 // wall-clock ms of µs-origin 0

// ── generic bundle builder: hand-author a manifest + arbitrary member files ──

interface MemberSpec {
  path: string
  type: "io" | "commands" | "frames" | "facts" | "checkpoint" | "habcp"
  encoding: "jsonl" | "hts1" | "trace-index" | "json" | "zstd-seekable"
  bytes: Uint8Array
}

function writeBundle(
  dir: string,
  opts: {
    members: MemberSpec[]
    cols?: number
    rows?: number
    durationMicros?: number
    originWallMs?: number
  },
): string {
  const bundle = join(dir, "session.tty")
  mkdirSync(bundle, { recursive: true })
  for (const m of opts.members) {
    const dest = join(bundle, m.path)
    mkdirSync(join(dest, ".."), { recursive: true })
    writeFileSync(dest, m.bytes)
  }
  const manifest = {
    ttyVersion: 1,
    recordingVersion: 1,
    cols: opts.cols ?? 80,
    rows: opts.rows ?? 24,
    durationMicros: opts.durationMicros ?? 0,
    reproducible: true,
    ...(opts.originWallMs !== undefined ? { originWallMs: opts.originWallMs } : {}),
    members: opts.members.map((m) => ({ path: m.path, type: m.type, encoding: m.encoding })),
  }
  writeFileSync(join(bundle, "manifest.json"), JSON.stringify(manifest, null, 2))
  return bundle
}

function ioJsonlMember(path: string, rows: { at: number; direction: "in" | "out"; data: string }[]): MemberSpec {
  return { path, type: "io", encoding: "jsonl", bytes: jsonl(rows) }
}

/** A `.tty` bundle whose only member is a jsonl io track — built through the existing (Trace-shaped) writer, so it is a real writer artifact, not hand-authored JSON. */
function jsonlBundle(dir: string): string {
  const bundle = join(dir, "session.tty")
  const rec = createRecording({
    cols: 80,
    rows: 24,
    durationMicros: micros(2_000_000),
    io: [
      { at: micros(0), direction: "out", data: "hello" },
      { at: micros(500_000), direction: "in", data: "world" },
    ],
  })
  writeRecording(bundle, rec)
  return bundle
}

function resizesOf(events: Event[]): Extract<Event, { type: "control"; control: "resize" }>[] {
  return events.filter(
    (e): e is Extract<Event, { type: "control"; control: "resize" }> => e.type === "control" && e.control === "resize",
  )
}

describe("loadRecording — jsonl io members", () => {
  test("matches recordingFromTrace(readRecording(dir)) event for event (bytes, at, type)", () => {
    const dir = tmp()
    try {
      const bundle = jsonlBundle(dir)
      const io = loadRecording(bundle)
      const trace = recordingFromTrace(readRecording(bundle))
      expect(io.events).toEqual(trace.events)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("sourceResolution is 'us'; header carries no timestamp (jsonl has no wall clock)", () => {
    const dir = tmp()
    try {
      const bundle = jsonlBundle(dir)
      const { header } = loadRecording(bundle)
      expect(header.sourceResolution).toBe("us")
      expect(header.timestamp).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("loadRecording — hts1 io members", () => {
  test("sourceResolution is 'ms'; header timestamp is the declared origin wall-clock", () => {
    const dir = tmp()
    try {
      const frames = concatBytes([
        htsFrame({ kind: "output", offset: 0, at: ORIGIN }, text("a")),
        htsFrame({ kind: "output", offset: 1, at: ORIGIN + 1_000 }, text("b")),
      ])
      const bundle = writeBundle(dir, {
        originWallMs: ORIGIN,
        members: [{ path: "io/seg.hts", type: "io", encoding: "hts1", bytes: frames }],
      })
      const { header } = loadRecording(bundle)
      expect(header.sourceResolution).toBe("ms")
      expect(header.timestamp).toBe(ORIGIN)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("with no declared originWallMs, timestamp is inferred from the first frame's wall-clock", () => {
    const dir = tmp()
    try {
      const frames = htsFrame({ kind: "output", offset: 0, at: ORIGIN }, text("a"))
      const bundle = writeBundle(dir, {
        members: [{ path: "io/seg.hts", type: "io", encoding: "hts1", bytes: frames }],
      })
      const { header } = loadRecording(bundle)
      expect(header.timestamp).toBe(ORIGIN)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a payload that is not valid UTF-8: this door keeps the exact bytes; the Trace door's text differs", () => {
    const dir = tmp()
    try {
      const badBytes = new Uint8Array([0xff, 0xfe, 0x41]) // invalid UTF-8 lead bytes + "A"
      const frames = htsFrame({ kind: "output", offset: 0, at: ORIGIN }, badBytes)
      const bundle = writeBundle(dir, {
        originWallMs: ORIGIN,
        members: [{ path: "io/seg.hts", type: "io", encoding: "hts1", bytes: frames }],
      })

      const io = loadRecording(bundle)
      const trace = readRecording(bundle)

      expect(io.events).toHaveLength(1)
      const event = io.events[0]!
      expect(event.type).toBe("output")
      expect((event as Extract<Event, { type: "output" }>).data).toEqual(badBytes)

      // The Trace door's utf8.decode of the SAME bytes mangled them — the
      // fossil this door's raw-bytes contract removes.
      const traceText = trace.io?.[0]?.data
      expect(traceText).toBeDefined()
      expect(new TextEncoder().encode(traceText!)).not.toEqual(badBytes)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a captured resize frame becomes a non-derived control/resize event; the Trace door shows the same frame in commands", () => {
    const dir = tmp()
    try {
      const frames = concatBytes([
        htsFrame({ kind: "output", offset: 0, at: ORIGIN }, text("$ ")),
        htsFrame({ kind: "input", offset: 1, at: ORIGIN + 200 }, text("ls\r")),
        htsFrame({ kind: "resize", offset: 2, at: ORIGIN + 500, size: { cols: 120, rows: 40 } }),
      ])
      const bundle = writeBundle(dir, {
        originWallMs: ORIGIN,
        members: [{ path: "io/seg.hts", type: "io", encoding: "hts1", bytes: frames }],
      })

      const io = loadRecording(bundle)
      const resizes = resizesOf(io.events)
      expect(resizes).toHaveLength(1)
      expect(resizes[0]).toMatchObject({ at: 500_000, control: "resize", size: { cols: 120, rows: 40 } })
      expect("derived" in resizes[0]!).toBe(false)
      for (const e of io.events) {
        if (e.type === "output" || e.type === "input") expect("derived" in e).toBe(false)
      }

      // The Trace door reads the SAME resize frame into its commands track —
      // both truths pinned on one fixture.
      const trace = readRecording(bundle)
      expect(trace.commands).toHaveLength(1)
      expect(trace.commands?.[0]).toEqual({ kind: "resize", at: 500_000, cols: 120, rows: 40 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("lifecycle/truncation frames are tallied — no Event form, same as the Trace door", () => {
    const dir = tmp()
    try {
      const frames = concatBytes([
        htsFrame({ kind: "lifecycle", offset: 0, at: ORIGIN, state: "awake" }),
        htsFrame({ kind: "output", offset: 1, at: ORIGIN }, text("$ ")),
        htsFrame({ kind: "truncation", offset: 2, at: ORIGIN + 1_000, retainedFromOffset: 1 }),
      ])
      const bundle = writeBundle(dir, {
        originWallMs: ORIGIN,
        members: [{ path: "io/seg.hts", type: "io", encoding: "hts1", bytes: frames }],
      })
      const { recording, skipped } = loadBundle(bundle)
      expect(recording.events).toHaveLength(1)
      expect(recording.events[0]!.type).toBe("output")
      expect(skipped.lifecycle).toBe(1)
      expect(skipped.truncation).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("mixed hts1 + jsonl io members: sourceResolution is 'ms' — hts1 presence wins", () => {
    const dir = tmp()
    try {
      const htsFrames = htsFrame({ kind: "output", offset: 0, at: ORIGIN }, text("a"))
      const bundle = writeBundle(dir, {
        originWallMs: ORIGIN,
        members: [
          { path: "io/seg.hts", type: "io", encoding: "hts1", bytes: htsFrames },
          ioJsonlMember("io.jsonl", [{ at: 0, direction: "out", data: "b" }]),
        ],
      })
      const { header } = loadRecording(bundle)
      expect(header.sourceResolution).toBe("ms")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("loadRecording — the skip tally and fail-loud paths", () => {
  test("the skipped tally lists commands/frames/facts/habcp/checkpoint member paths — not loaded, content never read", () => {
    const dir = tmp()
    try {
      const junk = text("irrelevant — never parsed by this door\n")
      const bundle = writeBundle(dir, {
        members: [
          ioJsonlMember("io.jsonl", [{ at: 0, direction: "out", data: "x" }]),
          { path: "commands.jsonl", type: "commands", encoding: "jsonl", bytes: junk },
          { path: "frames/index.jsonl", type: "frames", encoding: "trace-index", bytes: junk },
          { path: "facts/000.jsonl", type: "facts", encoding: "jsonl", bytes: junk },
          { path: "habcp.log", type: "habcp", encoding: "jsonl", bytes: junk },
          // Deliberately not valid JSON — proves a checkpoint member's
          // content is never read by this door, only its path tallied.
          { path: "checkpoints/000.json", type: "checkpoint", encoding: "json", bytes: junk },
        ],
      })
      const { skipped } = loadBundle(bundle)
      expect(skipped.commands).toEqual(["commands.jsonl"])
      expect(skipped.frames).toEqual(["frames/index.jsonl"])
      expect(skipped.facts).toEqual(["facts/000.jsonl"])
      expect(skipped.habcp).toEqual(["habcp.log"])
      expect(skipped.checkpoint).toEqual(["checkpoints/000.json"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a bundle with no events at all throws, naming the members it has", () => {
    const dir = tmp()
    try {
      const junk = text("junk\n")
      const bundle = writeBundle(dir, {
        members: [{ path: "commands.jsonl", type: "commands", encoding: "jsonl", bytes: junk }],
      })
      expect(() => loadRecording(bundle)).toThrow(/no events/)
      expect(() => loadRecording(bundle)).toThrow(/commands\.jsonl/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a checkpoints-only bundle (no io member) throws 'no events' too — checkpoints aren't loaded in this slice", () => {
    const dir = tmp()
    try {
      const bundle = writeBundle(dir, {
        members: [{ path: "checkpoints/000.json", type: "checkpoint", encoding: "json", bytes: text("not parsed") }],
      })
      expect(() => loadRecording(bundle)).toThrow(/no events/)
      expect(() => loadRecording(bundle)).toThrow(/checkpoints\/000\.json/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("loadRecording — encoding-blindness and header fallbacks", () => {
  test(".ttyz (sealed via packRecording) loads identically to its .tty bundle dir", () => {
    const dir = tmp()
    try {
      const bundle = jsonlBundle(dir)
      const sealed = join(dir, "session.ttyz")
      packRecording(bundle, sealed)
      expect(loadRecording(sealed)).toEqual(loadRecording(bundle))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("duration falls back to the last event's at when manifest.durationMicros is 0", () => {
    const dir = tmp()
    try {
      const bundle = writeBundle(dir, {
        durationMicros: 0,
        members: [
          ioJsonlMember("io.jsonl", [
            { at: 0, direction: "out", data: "a" },
            { at: 42_000, direction: "out", data: "b" },
          ]),
        ],
      })
      const { header } = loadRecording(bundle)
      expect(header.duration).toBe(42_000)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("size falls back to {0,0} when manifest cols/rows are 0 — frames aren't loaded by this door", () => {
    const dir = tmp()
    try {
      const bundle = writeBundle(dir, {
        cols: 0,
        rows: 0,
        members: [ioJsonlMember("io.jsonl", [{ at: 0, direction: "out", data: "x" }])],
      })
      const { header } = loadRecording(bundle)
      expect(header.size).toEqual({ cols: 0, rows: 0 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
