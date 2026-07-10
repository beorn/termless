/**
 * Temporal-family recomposition tests — `TraceFrame` composed over `Recording`.
 *
 * Slice 21016: the visual-trace family (`TraceFrame` + `FrameTracer` +
 * write/load-visual-trace) is recomposed as **Recording-frame + render
 * artifacts**, not a parallel timeline. These tests pin the two invariants the
 * recomposition must hold:
 *
 *  (a) The `frames` projection is the LOSSLESS carrier of a visual trace: the
 *      symmetric codec pair `traceToRecording` ⇄ `recordingToTraceFrames`
 *      round-trips an on-disk `TraceFrame[]` byte-for-byte (including the
 *      render artifacts `render_ms` / `ts` / `iso` the projection used to
 *      drop).
 *  (b) `writeVisualTrace` is expressible over the canonical `Recording` noun:
 *      writing a trace via the Recording path yields a byte-identical
 *      `index.jsonl` to the legacy raw-`TraceFrame[]` path.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createTerminal } from "../src/terminal/terminal.ts"
import { createFrameTracer } from "../src/recording/frame-trace.ts"
import { traceToRecording, recordingToTraceFrames } from "../src/recording/frame-trace-recording.ts"
import { loadVisualTrace } from "../src/recording/load-visual-trace.ts"
import { writeVisualTrace, writeVisualTraceFromRecording } from "../src/recording/write-visual-trace.ts"
import type { TraceFrame } from "../src/recording/frame-trace.ts"
import type { Terminal } from "../src/terminal/types.ts"
import { createVt100Backend } from "../packages/vt100/src/index.ts"

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "trace-recompose-"))
})

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

/** Deterministic 8-byte PNG stub — avoids the WASM canvas renderer. */
async function stubRender(_term: Terminal): Promise<Uint8Array> {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
}

/** Record a real frame-trace directory (silvery-free) by driving a vt100. */
async function recordTraceDir(dir: string): Promise<void> {
  let onWrite: ((data: Uint8Array) => void) | null = null
  const terminal = createTerminal({
    backend: createVt100Backend({ cols: 40, rows: 10 }),
    cols: 40,
    rows: 10,
    onAfterWrite: (data) => onWrite?.(data),
  })
  const tracer = createFrameTracer(terminal, {
    dir,
    debounceMs: 1,
    renderFn: stubRender,
    silveryEventsFile: null,
  })
  onWrite = tracer.onWrite
  terminal.feed("hello")
  await new Promise((r) => setTimeout(r, 20))
  terminal.feed(" world")
  await new Promise((r) => setTimeout(r, 20))
  await tracer.stop()
}

/** Parse an on-disk `index.jsonl` into its `TraceFrame[]` rows. */
function parseIndex(dir: string): TraceFrame[] {
  return readFileSync(join(dir, "index.jsonl"), "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as TraceFrame)
}

/** A hand-built fixture trace with non-trivial render artifacts. */
function fixtureRows(): TraceFrame[] {
  const base = 1_700_000_000_000
  return [
    {
      seq: 1,
      ts: base,
      iso: new Date(base).toISOString(),
      hash: "xxh64:a",
      duplicate_of: null,
      bytes_in_since_last: 5,
      ansi_input_preview: "hello",
      buffer: { cols: 40, rows: 10, cursor: { row: 0, col: 5 } },
      duration_since_prev_ms: 0,
      render_ms: 12.5,
      png: "00001.png",
    },
    {
      seq: 2,
      ts: base + 250,
      iso: new Date(base + 250).toISOString(),
      hash: "xxh64:b",
      duplicate_of: null,
      bytes_in_since_last: 6,
      ansi_input_preview: " world",
      buffer: { cols: 40, rows: 10, cursor: { row: 0, col: 11 } },
      duration_since_prev_ms: 250,
      render_ms: 3.25,
      png: "00002.png",
    },
    {
      seq: 3,
      ts: base + 400,
      iso: new Date(base + 400).toISOString(),
      hash: "xxh64:a",
      duplicate_of: 1,
      bytes_in_since_last: 0,
      ansi_input_preview: "",
      buffer: { cols: 40, rows: 10, cursor: { row: 0, col: 11 } },
      duration_since_prev_ms: 150,
      render_ms: 0,
      png: null,
    },
  ]
}

describe("frames projection carries render artifacts", () => {
  test("traceToRecording stamps the render artifacts onto each frame", () => {
    const rows = fixtureRows()
    const rec = traceToRecording({ frames: rows, cols: 40, rows: 10, backend: "vt100" })

    expect(rec.frames![0]!.artifacts).toEqual({ wallClockMs: rows[0]!.ts, renderMs: 12.5 })
    expect(rec.frames![1]!.artifacts).toEqual({ wallClockMs: rows[1]!.ts, renderMs: 3.25 })
    expect(rec.frames![2]!.artifacts).toEqual({ wallClockMs: rows[2]!.ts, renderMs: 0 })
    // `at` stays the normalized µs-from-start position — artifacts are the
    // absolute capture provenance, a distinct fact.
    expect(rec.frames![0]!.at).toBe(0)
    expect(rec.frames![1]!.at).toBe(250_000)
  })
})

describe("symmetric codec: traceToRecording ⇄ recordingToTraceFrames", () => {
  test("round-trips a hand-built fixture byte-for-byte", () => {
    const rows = fixtureRows()
    const rec = traceToRecording({ frames: rows, cols: 40, rows: 10, backend: "vt100" })
    expect(recordingToTraceFrames(rec)).toEqual(rows)
  })

  test("round-trips a real recorded trace byte-for-byte", async () => {
    const dir = join(root, "trace-codec")
    await recordTraceDir(dir)
    const rows = parseIndex(dir)
    const rec = loadVisualTrace(dir, { backend: "vt100" })
    expect(recordingToTraceFrames(rec)).toEqual(rows)
  })
})

describe("writeVisualTrace over the canonical Recording noun", () => {
  test("recomposed path yields a byte-identical index.jsonl to the legacy path", async () => {
    const srcDir = join(root, "wv-src")
    await recordTraceDir(srcDir)
    const srcRows = parseIndex(srcDir)

    // Legacy path: raw TraceFrame[] straight to disk.
    const legacyDir = join(root, "wv-legacy")
    writeVisualTrace(legacyDir, srcRows, { pngSourceDir: srcDir })

    // Recomposed path: load into the canonical Recording, write from it.
    const recomposedDir = join(root, "wv-recomposed")
    const recording = loadVisualTrace(srcDir, { backend: "vt100" })
    writeVisualTraceFromRecording(recomposedDir, recording, { pngSourceDir: srcDir })

    const legacyIndex = readFileSync(join(legacyDir, "index.jsonl")).toString("base64")
    const recomposedIndex = readFileSync(join(recomposedDir, "index.jsonl")).toString("base64")
    expect(recomposedIndex).toBe(legacyIndex)

    // And every PNG copied identically.
    for (const name of readdirSync(legacyDir)) {
      if (name === "index.jsonl") continue
      expect(readFileSync(join(recomposedDir, name)).toString("base64")).toBe(
        readFileSync(join(legacyDir, name)).toString("base64"),
      )
    }
  })

  test("recomposed write then load reproduces the Recording frames", async () => {
    const srcDir = join(root, "wv-rt-src")
    await recordTraceDir(srcDir)
    const recording = loadVisualTrace(srcDir, { backend: "vt100" })

    const destDir = join(root, "wv-rt-dest")
    writeVisualTraceFromRecording(destDir, recording, { pngSourceDir: srcDir })
    const reloaded = loadVisualTrace(destDir, { backend: "vt100" })

    expect(reloaded.frames!.length).toBe(recording.frames!.length)
    expect(recordingToTraceFrames(reloaded)).toEqual(recordingToTraceFrames(recording))
  })
})
