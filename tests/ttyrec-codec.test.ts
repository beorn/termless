/**
 * ttyrec → `Recording` codec tests (import-only — there is no encoder).
 *
 * ttyrec is a flat, header-less sequence of binary chunks — each chunk one
 * `[sec: u32 LE][usec: u32 LE][len: u32 LE][payload: len bytes]` record, with
 * `sec`/`usec` an *absolute wall-clock* timestamp. These tests hand-build raw
 * ttyrec bytes with `DataView` (independent of the decoder under test) and
 * assert the decoded `Recording`'s `io` track, timebase normalization, and
 * the tolerate-vs-throw corruption split documented on {@link decodeTtyrec}.
 */

import { describe, test, expect } from "vitest"
import { decodeTtyrec } from "../src/recording/ttyrec/recording-codec.ts"

const HEADER_BYTES = 12

interface RawChunk {
  sec: number
  usec: number
  data: string
}

/** Hand-build raw ttyrec bytes from timestamped chunks, via `DataView` — independent of the decoder under test. */
function buildTtyrec(chunks: RawChunk[]): Uint8Array {
  const encoder = new TextEncoder()
  const encoded = chunks.map((c) => ({ sec: c.sec, usec: c.usec, bytes: encoder.encode(c.data) }))
  const total = encoded.reduce((sum, c) => sum + HEADER_BYTES + c.bytes.length, 0)
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  let offset = 0
  for (const c of encoded) {
    view.setUint32(offset, c.sec, true)
    view.setUint32(offset + 4, c.usec, true)
    view.setUint32(offset + 8, c.bytes.length, true)
    out.set(c.bytes, offset + HEADER_BYTES)
    offset += HEADER_BYTES + c.bytes.length
  }
  return out
}

/** One raw 12-byte chunk header only (no payload bytes appended) — for building corrupt input by hand. */
function buildHeaderOnly(sec: number, usec: number, len: number): Uint8Array {
  const out = new Uint8Array(HEADER_BYTES)
  const view = new DataView(out.buffer)
  view.setUint32(0, sec, true)
  view.setUint32(4, usec, true)
  view.setUint32(8, len, true)
  return out
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

const T0 = 1_700_000_000 // arbitrary wall-clock epoch seconds
const THREE_CHUNKS: RawChunk[] = [
  { sec: T0, usec: 0, data: "$ " },
  { sec: T0, usec: 500_000, data: "ls\r\n" },
  { sec: T0 + 1, usec: 0, data: "file1  file2\r\n$ " },
]

describe("decodeTtyrec -- ttyrec chunks -> Recording (io track)", () => {
  test("decodes chunks into direction-tagged 'out' io events", () => {
    const recording = decodeTtyrec(buildTtyrec(THREE_CHUNKS))
    expect(recording.io).toBeDefined()
    expect(recording.io).toHaveLength(3)
    expect(recording.io!.every((e) => e.direction === "out")).toBe(true)
    expect(recording.io!.map((e) => e.data)).toEqual(["$ ", "ls\r\n", "file1  file2\r\n$ "])
    // commands / frames absent -- a decoded ttyrec is observed-truth only.
    expect(recording.commands).toBeUndefined()
    expect(recording.frames).toBeUndefined()
  })

  test("normalizes wall-clock timestamps to integer µs from the first chunk", () => {
    const recording = decodeTtyrec(buildTtyrec(THREE_CHUNKS))
    expect(recording.io![0]!.at).toBe(0)
    expect(recording.io![1]!.at).toBe(500_000)
    expect(recording.io![2]!.at).toBe(1_000_000)
    for (const e of recording.io!) expect(Number.isInteger(e.at)).toBe(true)
  })

  test("durationMicros is the last chunk's normalized time", () => {
    const recording = decodeTtyrec(buildTtyrec(THREE_CHUNKS))
    expect(recording.durationMicros).toBe(1_000_000)
  })

  test("defaults cols/rows to 80x24 when no options are given", () => {
    const recording = decodeTtyrec(buildTtyrec(THREE_CHUNKS))
    expect(recording.cols).toBe(80)
    expect(recording.rows).toBe(24)
  })

  test("accepts cols/rows overrides", () => {
    const recording = decodeTtyrec(buildTtyrec(THREE_CHUNKS), { cols: 120, rows: 40 })
    expect(recording.cols).toBe(120)
    expect(recording.rows).toBe(40)
  })
})

describe("decodeTtyrec -- time normalization", () => {
  test("normalizes 0s / 1.5s / 3s wall-clock deltas to 0 / 1_500_000 / 3_000_000 µs", () => {
    const bytes = buildTtyrec([
      { sec: T0, usec: 0, data: "a" },
      { sec: T0 + 1, usec: 500_000, data: "b" }, // t0 + 1.5s
      { sec: T0 + 3, usec: 0, data: "c" }, // t0 + 3s
    ])
    const recording = decodeTtyrec(bytes)
    expect(recording.io!.map((e) => e.at)).toEqual([0, 1_500_000, 3_000_000])
  })
})

describe("decodeTtyrec -- payload decoding", () => {
  test("decodes payload bytes as UTF-8, lossy-tolerant of invalid sequences", () => {
    const invalidUtf8 = new Uint8Array([0x68, 0x69, 0xff, 0xfe, 0x21]) // "hi" + invalid bytes + "!"
    const bytes = concatBytes([buildHeaderOnly(T0, 0, invalidUtf8.length), invalidUtf8])
    expect(() => decodeTtyrec(bytes)).not.toThrow()
    const recording = decodeTtyrec(bytes)
    expect(recording.io![0]!.data.startsWith("hi")).toBe(true)
    expect(recording.io![0]!.data.endsWith("!")).toBe(true)
  })
})

describe("decodeTtyrec -- malformed input", () => {
  test("tolerates a truncated final chunk -- stops cleanly, keeps prior events", () => {
    const full = buildTtyrec(THREE_CHUNKS)
    const truncated = full.slice(0, full.length - 3) // chop into the last chunk's payload
    const recording = decodeTtyrec(truncated)
    expect(recording.io).toHaveLength(2)
    expect(recording.io!.map((e) => e.data)).toEqual(["$ ", "ls\r\n"])
  })

  test("tolerates a truncated final chunk header -- stops cleanly, keeps prior events", () => {
    const full = buildTtyrec(THREE_CHUNKS)
    const firstTwo = buildTtyrec(THREE_CHUNKS.slice(0, 2)).length
    const truncated = full.slice(0, firstTwo + 5) // only 5 of the 3rd chunk's 12 header bytes present
    const recording = decodeTtyrec(truncated)
    expect(recording.io).toHaveLength(2)
    expect(recording.io!.map((e) => e.data)).toEqual(["$ ", "ls\r\n"])
  })

  test("throws on a mid-stream chunk with an impossibly large declared length", () => {
    const good1 = buildTtyrec([{ sec: T0, usec: 0, data: "ok" }])
    const corruptHeader = buildHeaderOnly(T0 + 1, 0, 0xffffffff)
    const goodTail = buildTtyrec([{ sec: T0 + 2, usec: 0, data: "also ok" }])
    const bytes = concatBytes([good1, corruptHeader, goodTail])

    expect(() => decodeTtyrec(bytes)).toThrow(/declared payload length 4294967295/)
  })

  test("throws when a chunk's timestamp regresses before the previous chunk's", () => {
    const bytes = buildTtyrec([
      { sec: T0 + 5, usec: 0, data: "later" },
      { sec: T0, usec: 0, data: "earlier" }, // time went backward
    ])
    expect(() => decodeTtyrec(bytes)).toThrow(/runs backward/)
  })

  test("throws on empty input -- a Recording needs at least one non-empty track", () => {
    expect(() => decodeTtyrec(new Uint8Array(0))).toThrow(/non-empty track/)
  })
})
