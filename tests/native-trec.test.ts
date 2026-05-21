/**
 * `.trec` native format — round-trip, legacy-superset, and pack/unpack tests.
 * Phase 5 of the recording-domain refactor.
 */
import { describe, expect, test } from "vitest"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  readRecording,
  writeRecording,
  packRecording,
  unpackRecording,
  isTrecPath,
} from "../src/recording/native/native-trec.ts"
import { createRecording, micros, secondsToMicros } from "../src/recording/recording.ts"

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "trec-test-"))
}

describe("native .trec format", () => {
  test("Recording → writeRecording → readRecording round-trips (commands + io)", () => {
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
      const trec = join(dir, "session.trec")
      writeRecording(trec, rec)
      const back = readRecording(trec)
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
    // no manifest.json — the pre-.trec layout. readRecording must accept it.
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

  test("pack → unpack round-trips a .trec directory", () => {
    const dir = tmp()
    try {
      const rec = createRecording({
        cols: 80,
        rows: 24,
        durationMicros: secondsToMicros(2),
        io: [{ at: micros(0), direction: "out", data: "x" }],
      })
      const src = join(dir, "a.trec")
      writeRecording(src, rec)

      const archive = join(dir, "a.trec.zip")
      packRecording(src, archive)
      expect(existsSync(archive)).toBe(true)

      const restored = join(dir, "restored.trec")
      unpackRecording(archive, restored)
      const back = readRecording(restored)
      expect(back.cols).toBe(80)
      expect(back.io).toHaveLength(1)
      expect(back.io?.[0]?.data).toBe("x")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("isTrecPath recognises the .trec extension", () => {
    expect(isTrecPath("foo.trec")).toBe(true)
    expect(isTrecPath("/a/b/session.trec")).toBe(true)
    expect(isTrecPath("foo.tape")).toBe(false)
    expect(isTrecPath("foo")).toBe(false)
  })
})
