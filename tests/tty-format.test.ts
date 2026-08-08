/**
 * `.tty` / `.ttyz` — the unified recording format: one format, two encodings,
 * one encoding-blind reader. Written red-first against the format reference
 * (docs/reference/formats/tty.md) as part of the format unification that
 * retires `.rec` (deleted, not aliased).
 *
 * Battery map:
 *  - round-trips: Recording → .ttyz file / .tty bundle dir → identical read
 *  - ENCODING-BLINDNESS: the same Recording read from a bundle and its seal
 *    is deep-equal; the read API exposes nothing that names the encoding
 *  - manifest v2: ttyVersion 1, declarative typed members, no `tracks` bag
 *  - declarative paths: a frames member at the bundle ROOT (the km-fixture
 *    shape — legacy index.jsonl + PNGs + one added manifest.json) reads fine
 *  - the bare legacy frame-trace dir (no manifest) now FAILS LOUD — the
 *    superset-compat branch is deleted; fixtures upgrade by gaining a manifest
 *  - hts1 io members: the binary journal framing decodes with the exact
 *    bridge mapping (output→out, input→in owner-dropped, resize→commands,
 *    lifecycle/truncation tallied), wall-ms rebased to the µs clock;
 *    tear ≠ corruption; backwards clocks throw
 *  - live bundles: an open tail is read; sealing rotates it; a .ttyz never
 *    carries a tail
 *  - fail-loud: reserved zstd-seekable and unknown encodings throw
 *  - zip: ZIP64 entry-count round-trip; per-member STORE for .png
 */
import { describe, expect, test } from "vitest"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  isTtyPath,
  isTtyzPath,
  packRecording,
  readBundle,
  readRecording,
  TTY_FORMAT_VERSION,
  type TtyManifest,
  unpackRecording,
  writeRecording,
} from "../src/recording/native/tty-format.ts"
import { buildZip, parseZip } from "../src/recording/native/zip-archive.ts"
import { createRecording, micros, secondsToMicros, type Recording } from "../src/recording/recording.ts"

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "tty-test-"))
}

function sampleRecording(): Recording {
  return createRecording({
    cols: 80,
    rows: 24,
    durationMicros: micros(5_000_000),
    commands: [
      { kind: "type", at: micros(0), text: "hello" },
      { kind: "sleep", at: micros(1_000_000), durationMicros: micros(500_000) },
    ],
    io: [
      { at: micros(0), direction: "in", data: "hello" },
      { at: micros(10_000), direction: "out", data: "hello\r\n" },
    ],
  })
}

// ── hts1 test encoder — hand-built per the format reference (BE u32s) ────────

type HtsHeader = {
  kind: "output" | "input" | "resize" | "lifecycle" | "truncation"
  offset: number
  at: number
  owner?: { peer: string }
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
  view.setUint32(5, headerBytes.length, false) // big-endian
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

/** A live bundle whose single io member is an hts1 file, hand-authored. */
function writeHtsBundle(
  dir: string,
  opts: {
    frames: Uint8Array
    originWallMs?: number
    asTail?: boolean
  },
): string {
  const bundle = join(dir, "session.tty")
  mkdirSync(join(bundle, "io"), { recursive: true })
  const memberPath = opts.asTail === true ? "io/current" : "io/00000000000000000000-00000000000000000003.hts"
  writeFileSync(join(bundle, memberPath), opts.frames)
  const manifest = {
    ttyVersion: 1,
    recordingVersion: 1,
    cols: 100,
    rows: 30,
    durationMicros: 3_000_000,
    reproducible: true,
    ...(opts.originWallMs !== undefined ? { originWallMs: opts.originWallMs } : {}),
    members:
      opts.asTail === true ? [] : [{ path: memberPath, type: "io", encoding: "hts1" }],
    ...(opts.asTail === true ? { tail: { path: memberPath, type: "io", encoding: "hts1" } } : {}),
  }
  writeFileSync(join(bundle, "manifest.json"), JSON.stringify(manifest, null, 2))
  return bundle
}

describe(".tty/.ttyz — round-trips and encoding-blindness", () => {
  test("Recording → .ttyz file → identical read", () => {
    const dir = tmp()
    try {
      const path = join(dir, "session.ttyz")
      writeRecording(path, sampleRecording())
      expect(statSync(path).isFile()).toBe(true)
      const back = readRecording(path)
      expect(back.cols).toBe(80)
      expect(back.commands).toHaveLength(2)
      expect(back.io).toHaveLength(2)
      expect(back.io?.[0]?.direction).toBe("in")
      expect(back.io?.[1]?.direction).toBe("out")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("Recording → .tty bundle dir → identical read", () => {
    const dir = tmp()
    try {
      const path = join(dir, "session.tty")
      writeRecording(path, sampleRecording())
      expect(statSync(path).isDirectory()).toBe(true)
      expect(existsSync(join(path, "manifest.json"))).toBe(true)
      const back = readRecording(path)
      expect(back.io).toHaveLength(2)
      expect(back.commands).toHaveLength(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("ENCODING-BLIND: bundle and its seal produce deep-equal Recordings", () => {
    const dir = tmp()
    try {
      const bundle = join(dir, "a.tty")
      const sealed = join(dir, "a.ttyz")
      writeRecording(bundle, sampleRecording())
      packRecording(bundle, sealed)
      const fromBundle = readRecording(bundle)
      const fromSealed = readRecording(sealed)
      expect(fromSealed).toEqual(fromBundle)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("unpack(seal) round-trips through the directory form", () => {
    const dir = tmp()
    try {
      const rec = createRecording({
        cols: 80,
        rows: 24,
        durationMicros: secondsToMicros(2),
        io: [{ at: micros(0), direction: "out", data: "x" }],
      })
      const sealed = join(dir, "a.ttyz")
      writeRecording(sealed, rec)
      const unpacked = join(dir, "a.tty")
      unpackRecording(sealed, unpacked)
      expect(statSync(unpacked).isDirectory()).toBe(true)
      expect(readRecording(unpacked).io?.[0]?.data).toBe("x")
      const resealed = join(dir, "b.ttyz")
      packRecording(unpacked, resealed)
      expect(readRecording(resealed)).toEqual(readRecording(unpacked))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("writeRecording refuses a path that names neither encoding", () => {
    const dir = tmp()
    try {
      expect(() => writeRecording(join(dir, "session.rec"), sampleRecording())).toThrow(/\.tty|\.ttyz/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("isTtyPath / isTtyzPath recognise the two encodings, and .rec is nobody", () => {
    expect(isTtyPath("foo.tty")).toBe(true)
    expect(isTtyPath("/a/b/session.tty")).toBe(true)
    expect(isTtyPath("foo.ttyz")).toBe(false)
    expect(isTtyzPath("foo.ttyz")).toBe(true)
    expect(isTtyzPath("foo.tty")).toBe(false)
    expect(isTtyPath("foo.rec")).toBe(false)
    expect(isTtyzPath("foo.rec")).toBe(false)
  })
})

describe("manifest v2 — typed declarative members", () => {
  test("the written manifest carries ttyVersion + members[], not a tracks bag", () => {
    const dir = tmp()
    try {
      const bundle = join(dir, "m.tty")
      writeRecording(bundle, sampleRecording())
      const manifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf-8")) as TtyManifest &
        Record<string, unknown>
      expect(manifest.ttyVersion).toBe(TTY_FORMAT_VERSION)
      expect(manifest.recordingVersion).toBe(1)
      expect(Array.isArray(manifest.members)).toBe(true)
      const types = manifest.members.map((m) => m.type).sort()
      expect(types).toEqual(["commands", "io"])
      for (const m of manifest.members) {
        expect(typeof m.path).toBe("string")
        expect(m.encoding).toBe("jsonl")
      }
      expect(manifest["tracks"]).toBeUndefined()
      expect(manifest["tail"]).toBeUndefined() // at-rest bundle — no open segment
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("declarative member path: a frames member at the bundle ROOT (km-fixture shape) reads", () => {
    const dir = tmp()
    try {
      // The upgraded-km-fixture shape: legacy index.jsonl + PNGs byte-identical,
      // plus ONE added manifest.json declaring the root-level frames member.
      const legacy = join(import.meta.dirname, "fixtures", "legacy-frame-trace")
      const bundle = join(dir, "golden.tty")
      mkdirSync(bundle, { recursive: true })
      cpSync(legacy, bundle, { recursive: true })
      writeFileSync(
        join(bundle, "manifest.json"),
        JSON.stringify({
          ttyVersion: 1,
          recordingVersion: 1,
          cols: 0, // frames-only bundles take geometry from the trace rows
          rows: 0,
          durationMicros: 0,
          reproducible: false,
          members: [{ path: "index.jsonl", type: "frames", encoding: "trace-index" }],
        }),
      )
      const rec = readRecording(bundle)
      expect(rec.frames).toBeDefined()
      expect(rec.frames!.length).toBeGreaterThan(0)
      expect(rec.io).toBeUndefined()
      expect(rec.provenance.reproducible).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a bare legacy frame-trace dir (no manifest) FAILS LOUD — the superset branch is deleted", () => {
    const legacy = join(import.meta.dirname, "fixtures", "legacy-frame-trace")
    expect(existsSync(join(legacy, "index.jsonl"))).toBe(true)
    expect(existsSync(join(legacy, "manifest.json"))).toBe(false)
    expect(() => readRecording(legacy)).toThrow(/manifest\.json/)
  })
})

describe("hts1 io members — the journal framing, decoded natively", () => {
  const ORIGIN = 1_754_620_000_000 // wall-clock ms of µs-origin 0

  function conversationFrames(): Uint8Array {
    return concatBytes([
      htsFrame({ kind: "lifecycle", offset: 0, at: ORIGIN, state: "awake" }),
      htsFrame({ kind: "output", offset: 1, at: ORIGIN, }, text("$ ")),
      htsFrame({ kind: "input", offset: 2, at: ORIGIN + 500, owner: { peer: "user" } }, text("ls\r")),
      htsFrame({ kind: "resize", offset: 3, at: ORIGIN + 1_000, size: { cols: 120, rows: 40 } }),
      htsFrame({ kind: "output", offset: 4, at: ORIGIN + 1_500 }, text("README.md\r\n")),
      htsFrame({ kind: "truncation", offset: 5, at: ORIGIN + 2_000, retainedFromOffset: 2 }),
    ])
  }

  test("decodes with the bridge mapping: output→out, input→in (owner dropped), resize→commands", () => {
    const dir = tmp()
    try {
      const bundle = writeHtsBundle(dir, { frames: conversationFrames(), originWallMs: ORIGIN })
      const { recording, skipped } = readBundle(bundle)
      expect(recording.io).toHaveLength(3)
      expect(recording.io?.[0]).toEqual({ at: 0, direction: "out", data: "$ " })
      expect(recording.io?.[1]?.direction).toBe("in")
      expect(recording.io?.[1]?.data).toBe("ls\r")
      expect("owner" in (recording.io?.[1] ?? {})).toBe(false)
      expect(recording.io?.[2]).toEqual({ at: micros(1_500_000), direction: "out", data: "README.md\r\n" })
      expect(recording.commands).toHaveLength(1)
      expect(recording.commands?.[0]).toEqual({ kind: "resize", at: micros(1_000_000), cols: 120, rows: 40 })
      // lifecycle + truncation carry no track — tallied, never silent.
      expect(skipped).toEqual({ lifecycle: 1, truncation: 1 })
      // readRecording (the blind door) returns the same Recording.
      expect(readRecording(bundle)).toEqual(recording)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("µs rebase: wall-ms deltas land at exact µs offsets", () => {
    const dir = tmp()
    try {
      const frames = concatBytes([
        htsFrame({ kind: "output", offset: 0, at: ORIGIN }, text("a")),
        htsFrame({ kind: "output", offset: 1, at: ORIGIN + 1_500 }, text("b")),
      ])
      const bundle = writeHtsBundle(dir, { frames, originWallMs: ORIGIN })
      const rec = readRecording(bundle)
      expect(rec.io?.map((e) => e.at)).toEqual([0, 1_500_000])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a torn tail is a TEAR: clean stop, complete frames kept", () => {
    const dir = tmp()
    try {
      const whole = conversationFrames()
      const torn = whole.slice(0, whole.length - 7) // cut inside the final frame
      const bundle = writeHtsBundle(dir, { frames: torn, originWallMs: ORIGIN })
      const { recording, skipped } = readBundle(bundle)
      // The final frame was the truncation marker — everything before survives.
      expect(recording.io).toHaveLength(3)
      expect(skipped).toEqual({ lifecycle: 1, truncation: 0 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("bad magic is CORRUPTION: throws, never a silent skip", () => {
    const dir = tmp()
    try {
      const bad = conversationFrames()
      bad[0] = 0x58 // "X" — wrong magic on the very first frame
      const bundle = writeHtsBundle(dir, { frames: bad, originWallMs: ORIGIN })
      expect(() => readRecording(bundle)).toThrow(/magic/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a wall clock before the origin throws — never clamped", () => {
    const dir = tmp()
    try {
      const frames = concatBytes([htsFrame({ kind: "output", offset: 0, at: ORIGIN - 1 }, text("x"))])
      const bundle = writeHtsBundle(dir, { frames, originWallMs: ORIGIN })
      expect(() => readRecording(bundle)).toThrow(/origin|monotonic|before/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("live bundles — the open tail", () => {
  const ORIGIN = 1_754_620_000_000

  test("a live bundle's tail is read; sealing rotates it and the seal reads identically", () => {
    const dir = tmp()
    try {
      const frames = concatBytes([
        htsFrame({ kind: "output", offset: 0, at: ORIGIN }, text("live ")),
        htsFrame({ kind: "output", offset: 1, at: ORIGIN + 100 }, text("tail")),
      ])
      const bundle = writeHtsBundle(dir, { frames, originWallMs: ORIGIN, asTail: true })
      const live = readRecording(bundle)
      expect(live.io?.map((e) => e.data).join("")).toBe("live tail")

      const sealed = join(dir, "sealed.ttyz")
      packRecording(bundle, sealed)
      const fromSeal = readRecording(sealed)
      expect(fromSeal).toEqual(live)
      // A .ttyz never carries an open tail.
      const entries = parseZip(new Uint8Array(readFileSync(sealed)))
      const manifest = JSON.parse(
        new TextDecoder().decode(entries.find((e) => e.path === "manifest.json")!.bytes),
      ) as Record<string, unknown>
      expect(manifest["tail"]).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("fail-loud on undecodable members", () => {
  test("the reserved zstd-seekable encoding throws until implemented — never skipped", () => {
    const dir = tmp()
    try {
      const bundle = join(dir, "z.tty")
      mkdirSync(bundle, { recursive: true })
      writeFileSync(join(bundle, "io.zst"), new Uint8Array([1, 2, 3]))
      writeFileSync(
        join(bundle, "manifest.json"),
        JSON.stringify({
          ttyVersion: 1,
          recordingVersion: 1,
          cols: 80,
          rows: 24,
          durationMicros: 0,
          reproducible: true,
          members: [{ path: "io.zst", type: "io", encoding: "zstd-seekable" }],
        }),
      )
      expect(() => readRecording(bundle)).toThrow(/zstd-seekable/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("an unknown member encoding throws with the encoding named", () => {
    const dir = tmp()
    try {
      const bundle = join(dir, "u.tty")
      mkdirSync(bundle, { recursive: true })
      writeFileSync(join(bundle, "io.bin"), new Uint8Array([1]))
      writeFileSync(
        join(bundle, "manifest.json"),
        JSON.stringify({
          ttyVersion: 1,
          recordingVersion: 1,
          cols: 80,
          rows: 24,
          durationMicros: 0,
          reproducible: true,
          members: [{ path: "io.bin", type: "io", encoding: "protobuf" }],
        }),
      )
      expect(() => readRecording(bundle)).toThrow(/protobuf/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("zip machinery — ZIP64 count + per-member method", () => {
  test("a 70,000-entry archive round-trips (entry count beyond the 16-bit EOCD field)", () => {
    const entries = Array.from({ length: 70_000 }, (_, i) => ({
      path: `e/${i}`,
      bytes: text(String(i)),
    }))
    const zip = buildZip(entries)
    const back = parseZip(zip)
    expect(back).toHaveLength(70_000)
    expect(new TextDecoder().decode(back[69_999]!.bytes)).toBe("69999")
    expect(back[12_345]!.path).toBe("e/12345")
  })

  test("PNG members are STORED, text members DEFLATED, in a sealed .ttyz", () => {
    const dir = tmp()
    try {
      // A bundle with a fake PNG member beside its frames index.
      const bundle = join(dir, "p.tty")
      mkdirSync(join(bundle, "frames"), { recursive: true })
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
      writeFileSync(join(bundle, "frames", "00001.png"), png)
      writeFileSync(join(bundle, "frames", "index.jsonl"), "")
      writeFileSync(
        join(bundle, "manifest.json"),
        JSON.stringify({
          ttyVersion: 1,
          recordingVersion: 1,
          cols: 1,
          rows: 1,
          durationMicros: 0,
          reproducible: false,
          members: [{ path: "frames/index.jsonl", type: "frames", encoding: "trace-index" }],
        }),
      )
      const sealed = join(dir, "p.ttyz")
      packRecording(bundle, sealed)
      const raw = new Uint8Array(readFileSync(sealed))
      const view = new DataView(raw.buffer)
      // Walk local headers; assert the png entry's method is 0 (STORE) and the
      // manifest's is 8 (DEFLATE).
      const methods = new Map<string, number>()
      let at = 0
      while (at + 4 <= raw.length && view.getUint32(at, true) === 0x04034b50) {
        const method = view.getUint16(at + 8, true)
        const compressed = view.getUint32(at + 18, true)
        const nameLen = view.getUint16(at + 26, true)
        const extraLen = view.getUint16(at + 28, true)
        const name = new TextDecoder().decode(raw.subarray(at + 30, at + 30 + nameLen))
        methods.set(name, method)
        at += 30 + nameLen + extraLen + compressed
      }
      expect(methods.get("frames/00001.png")).toBe(0)
      expect(methods.get("manifest.json")).toBe(8)
      // And the sealed bytes still parse as a coherent archive.
      expect(parseZip(raw).map((e) => e.path).sort()).toEqual([
        "frames/00001.png",
        "frames/index.jsonl",
        "manifest.json",
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
