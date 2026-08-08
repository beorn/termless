import { describe, expect, test } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { traceToRecording, unpackRecording, writeRecording, type TraceFrame } from "@termless/core"
import { formatInspectSummary, inspectRecordingBundle } from "../src/inspect-cmd.ts"

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "termless-inspect-"))
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function writeTrace(dir: string): void {
  const staging = mkdtempSync(join(tmpdir(), "termless-inspect-trace-"))
  try {
    writeFileSync(join(staging, "00001.png"), new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    const frames: TraceFrame[] = [
      {
        seq: 1,
        ts: 1000,
        iso: "2026-05-29T00:00:01.000Z",
        hash: "a",
        duplicate_of: null,
        bytes_in_since_last: 4,
        ansi_input_preview: "test",
        buffer: { cols: 80, rows: 24, cursor: { row: 0, col: 0 } },
        duration_since_prev_ms: 0,
        render_ms: 1,
        png: "00001.png",
      },
      {
        seq: 2,
        ts: 1042,
        iso: "2026-05-29T00:00:01.042Z",
        hash: "a",
        duplicate_of: 1,
        bytes_in_since_last: 0,
        ansi_input_preview: "",
        buffer: { cols: 80, rows: 24, cursor: { row: 0, col: 0 } },
        duration_since_prev_ms: 42,
        render_ms: 0,
        png: null,
      },
    ]
    const archive = join(staging, "frames.rec")
    writeRecording(archive, traceToRecording({ frames, cols: 80, rows: 24, backend: "ghostty" }), {
      pngSourceDir: staging,
    })
    unpackRecording(archive, dir)
    writeFileSync(join(dir, "frames", "viewer.html"), "<!doctype html>")
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

describe("inspectRecordingBundle", () => {
  test("summarizes a tape with an explicit Set Frames directory", () =>
    withTempDir((dir) => {
      const framesDir = join(dir, "demo.frames")
      const tapePath = join(dir, "demo.tape")
      writeTrace(framesDir)
      writeFileSync(
        tapePath,
        ['Set Backend "ghostty"', 'Set Frames "./demo.frames"', "Set FrameDebounceMs 16", 'Type "hello"', ""].join(
          "\n",
        ),
      )

      const summary = inspectRecordingBundle(tapePath)

      expect(summary.backend).toBe("ghostty")
      expect(summary.frameDebounceMs).toBe(16)
      expect(summary.frameTrace?.dir).toBe(framesDir)
      expect(summary.frameTrace?.frameCount).toBe(2)
      expect(summary.frameTrace?.uniqueCount).toBe(1)
      expect(summary.frameTrace?.duplicateRatio).toBe(0.5)
      expect(summary.frameTrace?.durationMs).toBe(42)
      expect(summary.frameTrace?.files).toEqual(["00001.png", "index.jsonl", "viewer.html"])
    }))

  test("falls back to the sibling .frames directory when the tape has no Set Frames", () =>
    withTempDir((dir) => {
      const tapePath = join(dir, "session.tape")
      const framesDir = join(dir, "session.frames")
      writeTrace(framesDir)
      writeFileSync(tapePath, 'Type "hello"\n')

      const summary = inspectRecordingBundle(tapePath)

      expect(summary.frameTrace?.dir).toBe(framesDir)
      expect(summary.frameTrace?.frameCount).toBe(2)
    }))

  test("formats the bundle summary for the CLI", () =>
    withTempDir((dir) => {
      const tapePath = join(dir, "demo.tape")
      const framesDir = join(dir, "demo.frames")
      writeTrace(framesDir)
      writeFileSync(tapePath, 'Set Backend "ghostty"\nSet Frames "./demo.frames"\n')

      const output = formatInspectSummary(inspectRecordingBundle(tapePath))

      expect(output).toContain("Tape: ")
      expect(output).toContain("Backend: ghostty")
      expect(output).toContain("Frames: 2 total, 1 unique, 50% duplicates")
      expect(output).toContain("Duration: 42ms")
      expect(output).toContain("Files: 00001.png, index.jsonl, viewer.html")
    }))
})
