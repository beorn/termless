/**
 * `.rec` native format — round-trip, legacy-superset, and pack/unpack tests.
 * Phase 5 of the recording-domain refactor.
 */
import { describe, expect, test } from "vitest"
import { mkdtempSync, rmSync, existsSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  readRecording,
  writeRecording,
  packRecording,
  unpackRecording,
  isRecPath,
} from "../src/recording/native/native-rec.ts"
import { createRecording, micros, secondsToMicros } from "../src/recording/recording.ts"

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "rec-test-"))
}

describe("native .rec format", () => {
  test("Recording → writeRecording → readRecording round-trips a single .rec file (commands + io)", () => {
    const dir = tmp()
    try {
      const rec = createRecording({
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
      const recPath = join(dir, "session.rec")
      writeRecording(recPath, rec)
      // `.rec` is a single FILE, not a directory.
      expect(statSync(recPath).isFile()).toBe(true)
      const back = readRecording(recPath)
      expect(back.cols).toBe(80)
      expect(back.rows).toBe(24)
      expect(back.commands).toHaveLength(2)
      expect(back.io).toHaveLength(2)
      expect(back.io?.[0]?.direction).toBe("in")
      expect(back.io?.[1]?.direction).toBe("out")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a bare legacy frame-trace directory loads as a frames-only Recording", () => {
    // tests/fixtures/legacy-frame-trace/ holds an index.jsonl + 00001.png with
    // no manifest.json — the pre-.rec layout. readRecording must accept it.
    const legacy = join(import.meta.dirname, "fixtures", "legacy-frame-trace")
    expect(existsSync(join(legacy, "index.jsonl"))).toBe(true)
    expect(existsSync(join(legacy, "manifest.json"))).toBe(false)

    const rec = readRecording(legacy)
    expect(rec.frames).toBeDefined()
    expect(rec.frames!.length).toBeGreaterThan(0)
    expect(rec.commands).toBeUndefined()
    expect(rec.io).toBeUndefined()
    // A bare frame trace has no io track — the visual state is the sole record.
    expect(rec.provenance.reproducible).toBe(false)
  })

  test("pack → unpack round-trips a .rec file via the directory working form", () => {
    const dir = tmp()
    try {
      const rec = createRecording({
        cols: 80,
        rows: 24,
        durationMicros: secondsToMicros(2),
        io: [{ at: micros(0), direction: "out", data: "x" }],
      })
      const recPath = join(dir, "a.rec")
      writeRecording(recPath, rec)

      // Unpack the single-file `.rec` to the directory working form.
      const unpacked = join(dir, "a-dir")
      unpackRecording(recPath, unpacked)
      expect(statSync(unpacked).isDirectory()).toBe(true)
      expect(existsSync(join(unpacked, "manifest.json"))).toBe(true)
      // The directory working form loads too.
      expect(readRecording(unpacked).cols).toBe(80)

      // Pack the directory back into a single `.rec` file.
      const repacked = join(dir, "b.rec")
      packRecording(unpacked, repacked)
      expect(statSync(repacked).isFile()).toBe(true)
      const back = readRecording(repacked)
      expect(back.cols).toBe(80)
      expect(back.io).toHaveLength(1)
      expect(back.io?.[0]?.data).toBe("x")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("isRecPath recognises the .rec extension", () => {
    expect(isRecPath("foo.rec")).toBe(true)
    expect(isRecPath("/a/b/session.rec")).toBe(true)
    expect(isRecPath("foo.tape")).toBe(false)
    expect(isRecPath("foo")).toBe(false)
  })
})
