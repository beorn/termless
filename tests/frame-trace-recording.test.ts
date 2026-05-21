/**
 * frame-trace → `Recording` projection tests.
 *
 * Phase 2 of the Recording-domain unification — proves a frame trace can be
 * represented as a `Recording` whose `frames` projection is populated.
 *
 * Critical invariant: the projection is **pure in-memory** — building a
 * Recording does NOT alter the on-disk `index.jsonl` + `NNNNN.png` layout.
 * One test asserts the on-disk bytes are identical before and after
 * `toRecording()`.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createTerminal } from "../src/terminal/terminal.ts"
import { createFrameTracer } from "../src/recording/frame-trace.ts"
import { traceToRecording, fingerprintFromCanvas } from "../src/recording/frame-trace-recording.ts"
import type { Terminal } from "../src/terminal/types.ts"
import { createVt100Backend } from "../packages/vt100/src/index.ts"

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "frame-trace-rec-"))
})

afterAll(() => {
  if (dir && statSync(dir).isDirectory()) rmSync(dir, { recursive: true, force: true })
})

async function stubRender(_term: Terminal): Promise<Uint8Array> {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])
}

/** Snapshot every file in a directory as `name → bytes`. */
function snapshotDir(d: string): Map<string, string> {
  const snap = new Map<string, string>()
  for (const name of readdirSync(d)) {
    const p = join(d, name)
    if (statSync(p).isFile()) {
      snap.set(name, Buffer.from(readFileSync(p)).toString("base64"))
    }
  }
  return snap
}

describe("frame-trace → Recording projection", () => {
  test("toRecording() populates the frames projection", async () => {
    let onAfterWrite: ((data: Uint8Array) => void) | undefined
    const term = createTerminal({
      backend: createVt100Backend(),
      cols: 20,
      rows: 5,
      onAfterWrite: (data) => onAfterWrite?.(data),
    })
    const tracer = createFrameTracer(term, { dir, debounceMs: 5, renderFn: stubRender })
    onAfterWrite = tracer.onWrite

    term.feed("hello")
    await new Promise((r) => setTimeout(r, 30))
    term.feed(" world")
    await new Promise((r) => setTimeout(r, 30))
    await tracer.stop()

    const recording = tracer.toRecording()
    expect(recording.frames).toBeDefined()
    expect(recording.frames!.length).toBeGreaterThanOrEqual(1)
    // A bare frame trace has no source tracks.
    expect(recording.commands).toBeUndefined()
    expect(recording.io).toBeUndefined()
    // With no io track recorded, the visual state is the sole record.
    expect(recording.provenance.reproducible).toBe(false)
  })

  test("projected frames carry a renderer fingerprint + content hash", async () => {
    let onAfterWrite: ((data: Uint8Array) => void) | undefined
    const term = createTerminal({
      backend: createVt100Backend(),
      cols: 20,
      rows: 5,
      onAfterWrite: (data) => onAfterWrite?.(data),
    })
    const tracer = createFrameTracer(term, {
      dir,
      debounceMs: 5,
      renderFn: stubRender,
      canvas: { cols: 20, rows: 5, fontSize: 16, dpr: 2 },
    })
    onAfterWrite = tracer.onWrite
    term.feed("abc")
    await new Promise((r) => setTimeout(r, 30))
    await tracer.stop()

    const recording = tracer.toRecording()
    for (const frame of recording.frames!) {
      expect(frame.fingerprint.backend).toBe("vt100")
      expect(frame.fingerprint.fontSize).toBe(16)
      expect(frame.fingerprint.cellSize.width).toBeGreaterThan(0)
      expect(frame.contentHash).toMatch(/^(xxh64|fnv1a):/)
      // µs timebase — every `at` is a non-negative integer.
      expect(Number.isInteger(frame.at)).toBe(true)
      expect(frame.at).toBeGreaterThanOrEqual(0)
    }
  })

  test("on-disk index.jsonl + PNG layout is byte-unchanged by toRecording()", async () => {
    const isolatedDir = mkdtempSync(join(tmpdir(), "frame-trace-iso-"))
    try {
      let onAfterWrite: ((data: Uint8Array) => void) | undefined
      const term = createTerminal({
        backend: createVt100Backend(),
        cols: 20,
        rows: 5,
        onAfterWrite: (data) => onAfterWrite?.(data),
      })
      const tracer = createFrameTracer(term, { dir: isolatedDir, debounceMs: 5, renderFn: stubRender })
      onAfterWrite = tracer.onWrite
      term.feed("hello")
      await new Promise((r) => setTimeout(r, 30))
      await tracer.stop()

      // Snapshot the on-disk trace, then project — the bytes must not move.
      const before = snapshotDir(isolatedDir)
      const recording = tracer.toRecording()
      const after = snapshotDir(isolatedDir)

      expect([...after.keys()].sort()).toEqual([...before.keys()].sort())
      for (const [name, bytes] of before) {
        expect(after.get(name)).toBe(bytes)
      }
      // index.jsonl frame count == projection frame count — same source.
      const indexLines = readFileSync(join(isolatedDir, "index.jsonl"), "utf-8")
        .split("\n")
        .filter((l) => l.trim().length > 0)
      expect(recording.frames!.length).toBe(indexLines.length)
    } finally {
      rmSync(isolatedDir, { recursive: true, force: true })
    }
  })

  test("traceToRecording rebases ms-epoch ts to µs-from-start", () => {
    const base = 1_700_000_000_000
    const recording = traceToRecording({
      frames: [
        {
          seq: 1,
          ts: base,
          iso: "",
          hash: "xxh64:a",
          duplicate_of: null,
          bytes_in_since_last: 5,
          ansi_input_preview: "hi",
          buffer: { cols: 20, rows: 5, cursor: { row: 0, col: 5 } },
          duration_since_prev_ms: 0,
          render_ms: 1,
          png: "00001.png",
        },
        {
          seq: 2,
          ts: base + 250,
          iso: "",
          hash: "xxh64:b",
          duplicate_of: null,
          bytes_in_since_last: 3,
          ansi_input_preview: "yo",
          buffer: { cols: 20, rows: 5, cursor: { row: 0, col: 8 } },
          duration_since_prev_ms: 250,
          render_ms: 1,
          png: "00002.png",
        },
      ],
      cols: 20,
      rows: 5,
      backend: "vt100",
    })
    expect(recording.frames![0]!.at).toBe(0)
    expect(recording.frames![1]!.at).toBe(250_000) // 250ms → 250_000µs
    expect(recording.durationMicros).toBe(250_000)
  })

  test("fingerprintFromCanvas synthesizes a fingerprint", () => {
    const fp = fingerprintFromCanvas("ghostty", { fontSize: 14, dpr: 2 })
    expect(fp).toMatchObject({ backend: "ghostty", fontSize: 14, dpr: 2 })
    expect(fp.cellSize.width).toBeGreaterThan(0)
    expect(fp.cellSize.height).toBeGreaterThan(0)
  })
})
