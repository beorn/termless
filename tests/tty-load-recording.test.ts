/**
 * `loadBundle` / `loadRecording` — the io-shaped `.tty`/`.ttyz` reader
 * (unterm phase A3, slice 5a; checkpoint records added in slice 5b).
 * `readBundle`/`readRecording` (tests/tty-format.test.ts) produce the
 * Trace-shaped Recording; these produce the io-shaped Recording (`Event[]`,
 * raw bytes, `@termless/core/io`) per docs/reference/formats/tty.md,
 * "Loading as an io Recording" and "Checkpoint member".
 *
 * Battery map:
 *  - jsonl bundle: matches recordingFromTrace(readRecording(dir)) event for
 *    event, modulo header.sourceResolution
 *  - hts1: raw payload bytes (the UTF-8-decode fossil the Trace door has and
 *    this door removes); a captured resize frame becomes a non-derived
 *    control/resize event (the Trace door reads the same frame into its
 *    commands track — both truths pinned); lifecycle/truncation frames are
 *    tallied, same as the Trace door
 *  - checkpoint members (slice 5b, D7–D9): LOADED — each record becomes a
 *    derived `mark`, anchored by `throughOffset` onto the last covered io
 *    event else by rebased `at`; a derived `control`/`resize` precedes the
 *    mark when the record's geometry (its `size`, else a raw v1 snapshot's
 *    own cols/rows) differs from the geometry last known and no captured
 *    resize happened since — one truth per resize, a capture always wins
 *  - sourceResolution: "ms" when any loaded io member is hts1, "us"
 *    otherwise; a bundle with no io member at all throws "no events" (same
 *    as any other bundle with nothing this door loads)
 *  - the skip tally: commands/frames/facts/habcp member paths, never a
 *    silent drop (checkpoint is no longer in this tally — see above)
 *  - fail-loud: no events at all (commands-only, a checkpoint member with
 *    zero records); malformed checkpoint JSON or a record with no numeric
 *    `at` throws naming the member
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

function marksOf(events: Event[]): Extract<Event, { type: "mark" }>[] {
  return events.filter((e): e is Extract<Event, { type: "mark" }> => e.type === "mark")
}

/** A `checkpoint` member: `content` is a record or an array of records — hand-authored JSON, per the producer's own shape (docs/reference/formats/tty.md, "Checkpoint member"). */
function checkpointMember(path: string, content: unknown): MemberSpec {
  return { path, type: "checkpoint", encoding: "json", bytes: new TextEncoder().encode(JSON.stringify(content)) }
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
  // Pre-A3 fixture note: this bundle used to also carry a `checkpoint`
  // member with deliberately-invalid JSON bytes, proving its content was
  // never read (slice 5a: checkpoints were tallied by path, not loaded). As
  // of slice 5b (D7–D9) checkpoint members ARE loaded — invalid JSON now
  // fails loud instead of being silently tallied (see the dedicated
  // "checkpoint records" describe block below) — so `checkpoint` is gone
  // from `TtyLoadSkipped` entirely and this fixture no longer includes one.
  test("the skipped tally lists commands/frames/facts/habcp member paths — not loaded, content never read", () => {
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
        ],
      })
      const { skipped } = loadBundle(bundle)
      expect(skipped.commands).toEqual(["commands.jsonl"])
      expect(skipped.frames).toEqual(["frames/index.jsonl"])
      expect(skipped.facts).toEqual(["facts/000.jsonl"])
      expect(skipped.habcp).toEqual(["habcp.log"])
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

  test("a checkpoints-only bundle with zero records throws 'no events' too — a mark needs a record", () => {
    const dir = tmp()
    try {
      // Valid JSON (an empty array of records) — under slice 5b a checkpoint
      // member with >=1 record always yields at least one mark Event, so
      // this fixture (unlike pre-5b's invalid-JSON junk) must be genuinely
      // empty to still exercise the "no events at all" path.
      const bundle = writeBundle(dir, {
        members: [{ path: "checkpoints/000.json", type: "checkpoint", encoding: "json", bytes: text("[]") }],
      })
      expect(() => loadRecording(bundle)).toThrow(/no events/)
      expect(() => loadRecording(bundle)).toThrow(/checkpoints\/000\.json/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("loadRecording — checkpoint records (D7–D9)", () => {
  test("two checkpoint records over an hts1 io member: marks anchored by throughOffset, one derived resize between them", () => {
    const dir = tmp()
    try {
      const frames = concatBytes([
        htsFrame({ kind: "output", offset: 0, at: ORIGIN }, text("a")),
        htsFrame({ kind: "output", offset: 1, at: ORIGIN + 100 }, text("b")),
        htsFrame({ kind: "output", offset: 2, at: ORIGIN + 200 }, text("c")),
      ])
      const bundle = writeBundle(dir, {
        originWallMs: ORIGIN,
        members: [
          { path: "io/seg.hts", type: "io", encoding: "hts1", bytes: frames },
          checkpointMember("checkpoints/000.json", [
            // Matches the manifest's own 80x24 — no derived resize expected.
            { at: ORIGIN + 5, reason: "auto", throughOffset: 0, snapshot: { version: 1, cols: 80, rows: 24 } },
            // Differs — expect one derived resize immediately before this mark.
            { at: ORIGIN + 205, throughOffset: 2, snapshot: { version: 1, cols: 120, rows: 40 } },
          ]),
        ],
      })

      const { events } = loadRecording(bundle)
      const marks = marksOf(events)
      const resizes = resizesOf(events)

      expect(marks).toHaveLength(2)
      expect(marks[0]).toMatchObject({ at: 0, name: "checkpoint:auto", derived: true })
      expect(marks[1]).toMatchObject({ at: 200_000, name: "checkpoint:1", derived: true })

      expect(resizes).toHaveLength(1)
      expect(resizes[0]).toMatchObject({ at: 200_000, size: { cols: 120, rows: 40 }, derived: true })

      // The derived resize sorts immediately before its record's mark (both at 200_000).
      expect(events.indexOf(resizes[0]!)).toBe(events.indexOf(marks[1]!) - 1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a captured hts1 resize between two checkpoints suppresses the derived resize — one truth per resize", () => {
    const dir = tmp()
    try {
      const frames = concatBytes([
        htsFrame({ kind: "output", offset: 0, at: ORIGIN }, text("a")),
        htsFrame({ kind: "input", offset: 1, at: ORIGIN + 100 }, text("b")),
        htsFrame({ kind: "resize", offset: 2, at: ORIGIN + 150, size: { cols: 100, rows: 30 } }),
        htsFrame({ kind: "output", offset: 3, at: ORIGIN + 200 }, text("c")),
      ])
      const bundle = writeBundle(dir, {
        originWallMs: ORIGIN,
        members: [
          { path: "io/seg.hts", type: "io", encoding: "hts1", bytes: frames },
          checkpointMember("checkpoints/000.json", [
            { at: ORIGIN + 5, throughOffset: 0, snapshot: { version: 1, cols: 80, rows: 24 } },
            // Declares 120x40 — differs from BOTH the manifest and the
            // capture's 100x30 — yet must still emit no derived resize: a
            // capture in the interval always wins, match or not.
            { at: ORIGIN + 205, throughOffset: 3, snapshot: { version: 1, cols: 120, rows: 40 } },
          ]),
        ],
      })

      const { events } = loadRecording(bundle)
      const resizes = resizesOf(events)
      expect(resizes).toHaveLength(1)
      expect(resizes[0]).toMatchObject({ at: 150_000, size: { cols: 100, rows: 30 } })
      expect("derived" in resizes[0]!).toBe(false)
      expect(marksOf(events)).toHaveLength(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a record with `size` and a v2 envelope snapshot: geometry comes from `size`", () => {
    const dir = tmp()
    try {
      const frames = htsFrame({ kind: "output", offset: 0, at: ORIGIN }, text("a"))
      const bundle = writeBundle(dir, {
        originWallMs: ORIGIN,
        members: [
          { path: "io/seg.hts", type: "io", encoding: "hts1", bytes: frames },
          checkpointMember("checkpoints/000.json", {
            at: ORIGIN + 5,
            throughOffset: 0,
            size: { cols: 100, rows: 30 },
            snapshot: { format: "vterm-snapshot-v2", data: "QUJD" },
          }),
        ],
      })

      const { events } = loadRecording(bundle)
      const resizes = resizesOf(events)
      expect(resizes).toHaveLength(1)
      expect(resizes[0]).toMatchObject({ size: { cols: 100, rows: 30 }, derived: true })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a v2 envelope snapshot with no `size`: mark only, geometry unknown, no resize", () => {
    const dir = tmp()
    try {
      const frames = htsFrame({ kind: "output", offset: 0, at: ORIGIN }, text("a"))
      const bundle = writeBundle(dir, {
        originWallMs: ORIGIN,
        members: [
          { path: "io/seg.hts", type: "io", encoding: "hts1", bytes: frames },
          checkpointMember("checkpoints/000.json", {
            at: ORIGIN + 5,
            throughOffset: 0,
            snapshot: { format: "vterm-snapshot-v2", data: "QUJD" },
          }),
        ],
      })

      const { events } = loadRecording(bundle)
      expect(marksOf(events)).toHaveLength(1)
      expect(resizesOf(events)).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a record is placed by rebased `at` when the io member is jsonl — no frame offsets to anchor by", () => {
    const dir = tmp()
    try {
      const bundle = writeBundle(dir, {
        originWallMs: ORIGIN,
        members: [
          ioJsonlMember("io.jsonl", [{ at: 0, direction: "out", data: "x" }]),
          // A large throughOffset is meaningless here — no io event carries
          // a frame offset in a jsonl-only bundle — so it must be ignored in
          // favor of the record's own rebased `at`.
          checkpointMember("checkpoints/000.json", { at: ORIGIN + 300, throughOffset: 999_999 }),
        ],
      })

      const { events } = loadRecording(bundle)
      const marks = marksOf(events)
      expect(marks).toHaveLength(1)
      expect(marks[0]).toMatchObject({ at: 300_000 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a single record (not wrapped in an array) is accepted", () => {
    const dir = tmp()
    try {
      const frames = htsFrame({ kind: "output", offset: 0, at: ORIGIN }, text("a"))
      const bundle = writeBundle(dir, {
        originWallMs: ORIGIN,
        members: [
          { path: "io/seg.hts", type: "io", encoding: "hts1", bytes: frames },
          checkpointMember("checkpoints/000.json", { at: ORIGIN + 5, reason: "boot", throughOffset: 0 }),
        ],
      })

      const { events } = loadRecording(bundle)
      const marks = marksOf(events)
      expect(marks).toHaveLength(1)
      expect(marks[0]).toMatchObject({ name: "checkpoint:boot", derived: true })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("malformed JSON in a checkpoint member throws, naming the member", () => {
    const dir = tmp()
    try {
      const bundle = writeBundle(dir, {
        members: [
          ioJsonlMember("io.jsonl", [{ at: 0, direction: "out", data: "x" }]),
          { path: "checkpoints/000.json", type: "checkpoint", encoding: "json", bytes: text("not json {{{") },
        ],
      })
      expect(() => loadRecording(bundle)).toThrow(/not valid JSON/)
      expect(() => loadRecording(bundle)).toThrow(/checkpoints\/000\.json/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a checkpoint record with no numeric `at` throws, naming the member", () => {
    const dir = tmp()
    try {
      const bundle = writeBundle(dir, {
        members: [
          ioJsonlMember("io.jsonl", [{ at: 0, direction: "out", data: "x" }]),
          checkpointMember("checkpoints/000.json", [{ reason: "no-at" }]),
        ],
      })
      expect(() => loadRecording(bundle)).toThrow(/no numeric "at"/)
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
