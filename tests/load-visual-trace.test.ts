/**
 * `loadVisualTrace` / `writeVisualTrace` tests.
 *
 * Phase 4 of the Recording-domain unification — proves termless owns the
 * frame-trace directory layout (the cross-repo ABI). A consumer (km's
 * `toMatchVisualTrace`) reads a trace directory into a `Recording` via
 * `loadVisualTrace` and writes one via `writeVisualTrace`, never touching the
 * on-disk `index.jsonl` + `NNNNN.png` shape itself.
 *
 * Critical invariant: `writeVisualTrace` → `loadVisualTrace` round-trips, and a
 * trace directory written by `writeVisualTrace` is byte-identical (`index.jsonl`
 * + PNGs) to the one it was copied from.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createTerminal } from "../src/terminal.ts"
import { createFrameTracer } from "../src/frame-trace.ts"
import { loadVisualTrace } from "../src/load-visual-trace.ts"
import { writeVisualTrace } from "../src/write-visual-trace.ts"
import type { Frame } from "../src/frame-trace.ts"
import type { Terminal } from "../src/types.ts"
import { createVt100Backend } from "../packages/vt100/src/index.ts"

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "load-visual-trace-"))
})

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

/** Deterministic 8-byte PNG stub — avoids the WASM canvas renderer. */
async function stubRender(_term: Terminal): Promise<Uint8Array> {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
}

/**
 * Record a real frame-trace directory by driving a vt100 terminal through the
 * frame tracer. Returns the trace directory path once `stop()` has flushed.
 */
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

/** Snapshot every file in a directory as `name → base64(bytes)`. */
function snapshotDir(d: string): Map<string, string> {
  const snap = new Map<string, string>()
  for (const name of readdirSync(d)) {
    snap.set(name, readFileSync(join(d, name)).toString("base64"))
  }
  return snap
}

describe("loadVisualTrace", () => {
  test("loads a real frame-trace directory into a Recording", async () => {
    const traceDir = join(root, "trace-load")
    await recordTraceDir(traceDir)

    const recording = loadVisualTrace(traceDir, { backend: "vt100" })

    expect(recording.version).toBe(1)
    expect(recording.cols).toBe(40)
    expect(recording.rows).toBe(10)
    // A bare frame trace records no io track — frames is the sole record.
    expect(recording.provenance.reproducible).toBe(false)
    expect(recording.commands).toBeUndefined()
    expect(recording.io).toBeUndefined()
    expect(recording.frames).toBeDefined()
    expect(recording.frames!.length).toBeGreaterThan(0)

    // The frames projection carries the on-disk Frame fields, re-shaped.
    const first = recording.frames![0]!
    expect(first.seq).toBe(1)
    expect(first.at).toBe(0) // first frame rebased to t=0
    expect(first.fingerprint.backend).toBe("vt100")
    expect(typeof first.contentHash).toBe("string")
    // The unique first frame owns a PNG (relative filename, bytes not loaded).
    expect(first.png).toBe("00001.png")
  })

  test("throws when index.jsonl is missing", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "load-visual-trace-empty-"))
    try {
      expect(() => loadVisualTrace(emptyDir)).toThrow(/no index\.jsonl/)
    } finally {
      rmSync(emptyDir, { recursive: true, force: true })
    }
  })

  test("throws when index.jsonl has no parseable frames", () => {
    const blankDir = mkdtempSync(join(tmpdir(), "load-visual-trace-blank-"))
    try {
      writeFileSync(join(blankDir, "index.jsonl"), "\n\nnot json\n")
      expect(() => loadVisualTrace(blankDir)).toThrow(/no parseable frames/)
    } finally {
      rmSync(blankDir, { recursive: true, force: true })
    }
  })

  test("tolerates a truncated final line", async () => {
    const traceDir = join(root, "trace-truncated")
    await recordTraceDir(traceDir)
    // Append a half-written final line — an interrupted trace.
    const indexFile = join(traceDir, "index.jsonl")
    writeFileSync(indexFile, readFileSync(indexFile, "utf-8") + '{"seq":99,"buffer":{"co')

    const recording = loadVisualTrace(traceDir, { backend: "vt100" })
    // The malformed line is skipped — only the well-formed frames survive.
    expect(recording.frames!.every((f) => f.seq !== 99)).toBe(true)
    expect(recording.frames!.length).toBeGreaterThan(0)
  })
})

describe("writeVisualTrace", () => {
  test("round-trips: write then load reproduces the Recording", async () => {
    const srcDir = join(root, "trace-rt-src")
    await recordTraceDir(srcDir)
    const srcRecording = loadVisualTrace(srcDir, { backend: "vt100" })

    // Re-derive the on-disk Frame[] (writeVisualTrace works on the tracer's
    // Frame shape) by re-reading index.jsonl.
    const srcFrames = readFileSync(join(srcDir, "index.jsonl"), "utf-8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Frame)

    const destDir = join(root, "trace-rt-dest")
    writeVisualTrace(destDir, srcFrames, { pngSourceDir: srcDir })

    const destRecording = loadVisualTrace(destDir, { backend: "vt100" })
    expect(destRecording.frames!.length).toBe(srcRecording.frames!.length)
    expect(destRecording.cols).toBe(srcRecording.cols)
    expect(destRecording.rows).toBe(srcRecording.rows)
  })

  test("written trace directory is byte-identical to the source", async () => {
    const srcDir = join(root, "trace-bytes-src")
    await recordTraceDir(srcDir)
    const srcFrames = readFileSync(join(srcDir, "index.jsonl"), "utf-8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Frame)

    const destDir = join(root, "trace-bytes-dest")
    writeVisualTrace(destDir, srcFrames, { pngSourceDir: srcDir })

    // index.jsonl + every PNG copied byte-identically. The source dir also
    // holds a viewer.html (written by stop()); writeVisualTrace writes only
    // the index + PNGs, so compare those.
    const destSnap = snapshotDir(destDir)
    const srcIndex = readFileSync(join(srcDir, "index.jsonl")).toString("base64")
    expect(destSnap.get("index.jsonl")).toBe(srcIndex)
    for (const [name, bytes] of destSnap) {
      if (name === "index.jsonl") continue
      expect(name.endsWith(".png")).toBe(true)
      expect(bytes).toBe(readFileSync(join(srcDir, name)).toString("base64"))
    }
  })

  test("wipes prior contents of the destination directory", async () => {
    const srcDir = join(root, "trace-wipe-src")
    await recordTraceDir(srcDir)
    const srcFrames = readFileSync(join(srcDir, "index.jsonl"), "utf-8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Frame)

    const destDir = mkdtempSync(join(tmpdir(), "trace-wipe-dest-"))
    writeFileSync(join(destDir, "stale.txt"), "should be removed")
    writeVisualTrace(destDir, srcFrames, { pngSourceDir: srcDir })

    expect(readdirSync(destDir)).not.toContain("stale.txt")
    expect(readdirSync(destDir)).toContain("index.jsonl")
    rmSync(destDir, { recursive: true, force: true })
  })
})
