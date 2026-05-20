import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createTerminal } from "../src/terminal.ts"
import { createFrameTracer } from "../src/frame-trace.ts"
import type { Terminal } from "../src/types.ts"

// Use the vt100 backend — pure-TS, no native deps, fast for tests.
import { createVt100Backend } from "../packages/vt100/src/index.ts"

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "frame-trace-"))
})

afterAll(() => {
  if (dir && statSync(dir).isDirectory()) rmSync(dir, { recursive: true, force: true })
})

// Stub renderer — produces deterministic 8-byte payload per call.
// Tests don't need real PNGs and we want to skip a chromium launch.
async function stubRender(_term: Terminal): Promise<Uint8Array> {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])
}

// Frame captures are debounced and run as fire-and-forget async work, so a
// fixed sleep races them on slow runners. Poll until the tracer has recorded
// at least `n` frames (or time out) — deterministic across platforms.
async function waitForFrames(
  tracer: { framesSinceSeq(seq: number): unknown[] },
  n: number,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (tracer.framesSinceSeq(0).length < n) {
    if (Date.now() > deadline) {
      throw new Error(`waitForFrames: only ${tracer.framesSinceSeq(0).length}/${n} frames after ${timeoutMs}ms`)
    }
    await new Promise((r) => setTimeout(r, 2))
  }
}

describe("createFrameTracer", () => {
  test("captures a frame after debounce when writes arrive", async () => {
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
    })
    onAfterWrite = tracer.onWrite

    term.feed("hello")
    // wait past debounce
    await new Promise((r) => setTimeout(r, 30))

    const frames = tracer.framesSinceSeq(0)
    expect(frames.length).toBeGreaterThanOrEqual(1)
    expect(frames[0]!.png).toBe("00001.png")
    expect(frames[0]!.bytes_in_since_last).toBe(5)

    const summary = await tracer.stop()
    expect(summary.count).toBeGreaterThanOrEqual(1)
    expect(summary.uniqueCount).toBeGreaterThanOrEqual(1)
    expect(summary.indexFile).toContain("index.jsonl")

    // Index is line-delimited JSON.
    const indexLines = readFileSync(summary.indexFile, "utf-8").trim().split("\n")
    expect(indexLines.length).toBe(summary.count)
    const parsed = indexLines.map((l) => JSON.parse(l))
    expect(parsed[0].seq).toBe(1)
    expect(parsed[0].hash).toMatch(/^(xxh64|fnv1a):/)
  })

  test("identical buffer state yields duplicate_of without writing a new PNG", async () => {
    const dir2 = mkdtempSync(join(tmpdir(), "frame-trace-dup-"))
    try {
      let hook: ((data: Uint8Array) => void) | undefined
      const term = createTerminal({
        backend: createVt100Backend(),
        cols: 10,
        rows: 3,
        onAfterWrite: (data) => hook?.(data),
      })
      const tracer = createFrameTracer(term, { dir: dir2, debounceMs: 5, renderFn: stubRender })
      hook = tracer.onWrite

      term.feed("abc")
      await new Promise((r) => setTimeout(r, 30))
      // Re-feed an ANSI no-op (cursor save+restore) — same final buffer state.
      term.feed("\x1b7\x1b8")
      await new Promise((r) => setTimeout(r, 30))

      const frames = tracer.framesSinceSeq(0)
      expect(frames.length).toBeGreaterThanOrEqual(2)
      // At least one of the later frames must be a duplicate.
      const dups = frames.filter((f) => f.duplicate_of != null)
      expect(dups.length).toBeGreaterThanOrEqual(1)
      // The dup's png should be null.
      expect(dups[0]!.png).toBeNull()

      const pngFiles = readdirSync(dir2).filter((f) => f.endsWith(".png"))
      // Only unique frames write PNGs.
      expect(pngFiles.length).toBeLessThan(frames.length)

      await tracer.stop()
    } finally {
      rmSync(dir2, { recursive: true, force: true })
    }
  })

  test("maxFrames cap stops further captures", async () => {
    const dir3 = mkdtempSync(join(tmpdir(), "frame-trace-cap-"))
    try {
      let hook: ((data: Uint8Array) => void) | undefined
      const term = createTerminal({
        backend: createVt100Backend(),
        cols: 5,
        rows: 2,
        onAfterWrite: (data) => hook?.(data),
      })
      const tracer = createFrameTracer(term, { dir: dir3, debounceMs: 2, maxFrames: 2, renderFn: stubRender })
      hook = tracer.onWrite

      for (let i = 0; i < 5; i++) {
        term.feed(`${i}`)
        await new Promise((r) => setTimeout(r, 8))
      }

      const summary = await tracer.stop()
      expect(summary.count).toBeLessThanOrEqual(2)
      expect(summary.truncated).toBe(true)
    } finally {
      rmSync(dir3, { recursive: true, force: true })
    }
  })

  test("framesSinceTime filters by ts", async () => {
    const dir4 = mkdtempSync(join(tmpdir(), "frame-trace-since-"))
    try {
      let hook: ((data: Uint8Array) => void) | undefined
      const term = createTerminal({
        backend: createVt100Backend(),
        cols: 10,
        rows: 2,
        onAfterWrite: (data) => hook?.(data),
      })
      const tracer = createFrameTracer(term, { dir: dir4, debounceMs: 2, renderFn: stubRender })
      hook = tracer.onWrite

      // Frame captures are debounced + async (`void captureFrame()`), so
      // blind `setTimeout` sleeps race the capture on slow runners — on
      // Windows CI the post-feed("b") capture had not run when the assertion
      // fired, yielding `after.length === 0`. Wait deterministically for the
      // expected frame count instead of guessing a sleep duration.
      term.feed("a")
      await waitForFrames(tracer, 1)
      // tMid must sit strictly between frame 1 and frame 2's wall-clock
      // capture times. Date.now() is coarse on Windows (~15.6ms granularity),
      // so sleep well past one tick before sampling it so frame 2 — captured
      // even later — reliably lands at ts >= tMid.
      await new Promise((r) => setTimeout(r, 25))
      const tMid = Date.now()
      await new Promise((r) => setTimeout(r, 25))
      term.feed("b")
      await waitForFrames(tracer, 2)

      const after = tracer.framesSinceTime(tMid)
      const all = tracer.framesSinceSeq(0)
      expect(all.length).toBeGreaterThanOrEqual(after.length)
      expect(after.length).toBeGreaterThanOrEqual(1)

      await tracer.stop()
    } finally {
      rmSync(dir4, { recursive: true, force: true })
    }
  })
})
