import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createTerminal } from "../src/terminal/terminal.ts"
import { createFrameTracer } from "../src/recording/frame-trace.ts"
import type { TraceFrame, SilveryRenderEvent } from "../src/recording/frame-trace.ts"
import type { Terminal } from "../src/terminal/types.ts"

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
    const parsed = indexLines.map((l) => JSON.parse(l) as { seq: number; hash: string })
    expect(parsed[0]!.seq).toBe(1)
    expect(parsed[0]!.hash).toMatch(/^(xxh64|fnv1a):/)
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

  test("joins silvery render events onto frames by ts", async () => {
    const dirS = mkdtempSync(join(tmpdir(), "frame-trace-silvery-"))
    try {
      // Write a render-event sidecar BEFORE capturing any frame, simulating
      // silvery's SILVERY_TRACE_FRAMES output. Two events with timestamps
      // well in the past so any captured frame's ts is >= both.
      const t0 = Date.now() - 10_000
      const evA: SilveryRenderEvent = {
        type: "RENDER_DISPATCHED",
        ts: t0,
        renderCount: 1,
        reason: "initial",
        dirtyRegions: [{ row: 0, height: 5 }],
        signalDelta: { nodesVisited: 12, nodesRendered: 12, nodesSkipped: 0, incremental: false },
        fiberHash: "12:0",
      }
      const evB: SilveryRenderEvent = {
        type: "RENDER_DISPATCHED",
        ts: t0 + 1, // 1ms later — still in the past relative to the frame
        renderCount: 2,
        reason: "content,subtree",
        dirtyRegions: [{ row: 2, height: 1 }],
        signalDelta: { nodesVisited: 12, nodesRendered: 3, nodesSkipped: 9, incremental: true },
        fiberHash: "12:7",
      }
      writeFileSync(join(dirS, "render-events.jsonl"), JSON.stringify(evA) + "\n" + JSON.stringify(evB) + "\n")

      let hook: ((data: Uint8Array) => void) | undefined
      const term = createTerminal({
        backend: createVt100Backend(),
        cols: 10,
        rows: 5,
        onAfterWrite: (data) => hook?.(data),
      })
      const tracer = createFrameTracer(term, { dir: dirS, debounceMs: 5, renderFn: stubRender })
      hook = tracer.onWrite

      term.feed("hi")
      await new Promise((r) => setTimeout(r, 30))

      const frames = tracer.framesSinceSeq(0) as TraceFrame[]
      expect(frames.length).toBeGreaterThanOrEqual(1)
      // Frame ts > both events → joins the latest preceding event (evB).
      const joined = frames[0]!.silvery as SilveryRenderEvent
      expect(joined).toBeDefined()
      expect(joined.type).toBe("RENDER_DISPATCHED")
      expect(joined.reason).toBe("content,subtree")
      expect(joined.renderCount).toBe(2)
      expect(joined.signalDelta.nodesRendered).toBe(3)
      expect(joined.fiberHash).toBe("12:7")

      const summary = await tracer.stop()
      // The index.jsonl row carries the joined silvery field.
      const indexLines = readFileSync(summary.indexFile, "utf-8").trim().split("\n")
      const row = JSON.parse(indexLines[0]!) as {
        silvery: { reason: string; signalDelta: { incremental: boolean } }
      }
      expect(row.silvery).toBeDefined()
      expect(row.silvery.reason).toBe("content,subtree")
      expect(row.silvery.signalDelta.incremental).toBe(true)
    } finally {
      rmSync(dirS, { recursive: true, force: true })
    }
  })

  test("frames have no silvery field when no sidecar exists", async () => {
    const dirN = mkdtempSync(join(tmpdir(), "frame-trace-nosilvery-"))
    try {
      let hook: ((data: Uint8Array) => void) | undefined
      const term = createTerminal({
        backend: createVt100Backend(),
        cols: 10,
        rows: 3,
        onAfterWrite: (data) => hook?.(data),
      })
      // No render-events.jsonl in dirN → join is a no-op.
      const tracer = createFrameTracer(term, { dir: dirN, debounceMs: 5, renderFn: stubRender })
      hook = tracer.onWrite

      term.feed("x")
      await new Promise((r) => setTimeout(r, 30))

      const frames = tracer.framesSinceSeq(0) as TraceFrame[]
      expect(frames.length).toBeGreaterThanOrEqual(1)
      expect(frames[0]!.silvery).toBeUndefined()

      await tracer.stop()
    } finally {
      rmSync(dirN, { recursive: true, force: true })
    }
  })

  test("silveryEventsFile: null disables the join even when a sidecar exists", async () => {
    const dirD = mkdtempSync(join(tmpdir(), "frame-trace-silvery-off-"))
    try {
      const ev: SilveryRenderEvent = {
        type: "RENDER_DISPATCHED",
        ts: Date.now() - 5000,
        renderCount: 1,
        reason: "initial",
        dirtyRegions: [],
        signalDelta: { nodesVisited: 1, nodesRendered: 1, nodesSkipped: 0, incremental: false },
        fiberHash: "1:0",
      }
      writeFileSync(join(dirD, "render-events.jsonl"), JSON.stringify(ev) + "\n")

      let hook: ((data: Uint8Array) => void) | undefined
      const term = createTerminal({
        backend: createVt100Backend(),
        cols: 8,
        rows: 3,
        onAfterWrite: (data) => hook?.(data),
      })
      const tracer = createFrameTracer(term, {
        dir: dirD,
        debounceMs: 5,
        renderFn: stubRender,
        silveryEventsFile: null,
      })
      hook = tracer.onWrite

      term.feed("z")
      await new Promise((r) => setTimeout(r, 30))

      const frames = tracer.framesSinceSeq(0) as TraceFrame[]
      expect(frames.length).toBeGreaterThanOrEqual(1)
      expect(frames[0]!.silvery).toBeUndefined()

      await tracer.stop()
    } finally {
      rmSync(dirD, { recursive: true, force: true })
    }
  })

  test("malformed sidecar lines are skipped without breaking the trace", async () => {
    const dirM = mkdtempSync(join(tmpdir(), "frame-trace-silvery-bad-"))
    try {
      const good: SilveryRenderEvent = {
        type: "RENDER_DISPATCHED",
        ts: Date.now() - 5000,
        renderCount: 9,
        reason: "dims-changed",
        dirtyRegions: [{ row: 0, height: 3 }],
        signalDelta: { nodesVisited: 4, nodesRendered: 4, nodesSkipped: 0, incremental: false },
        fiberHash: "4:2",
      }
      // A truncated line, a non-JSON line, a JSON line of the wrong type,
      // then one valid event.
      writeFileSync(
        join(dirM, "render-events.jsonl"),
        '{"type":"RENDER_DISPAT\n' +
          "not json at all\n" +
          '{"type":"SOMETHING_ELSE","ts":1}\n' +
          JSON.stringify(good) +
          "\n",
      )

      let hook: ((data: Uint8Array) => void) | undefined
      const term = createTerminal({
        backend: createVt100Backend(),
        cols: 8,
        rows: 3,
        onAfterWrite: (data) => hook?.(data),
      })
      const tracer = createFrameTracer(term, { dir: dirM, debounceMs: 5, renderFn: stubRender })
      hook = tracer.onWrite

      term.feed("q")
      await new Promise((r) => setTimeout(r, 30))

      const frames = tracer.framesSinceSeq(0) as TraceFrame[]
      expect(frames.length).toBeGreaterThanOrEqual(1)
      // Only the one valid event survives parsing and gets joined.
      const joined = frames[0]!.silvery as SilveryRenderEvent
      expect(joined).toBeDefined()
      expect(joined.reason).toBe("dims-changed")
      expect(joined.renderCount).toBe(9)

      await tracer.stop()
    } finally {
      rmSync(dirM, { recursive: true, force: true })
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
