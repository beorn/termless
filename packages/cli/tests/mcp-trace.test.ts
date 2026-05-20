/**
 * Tests for the session manager's FrameTracer integration — exercises the
 * surface the MCP `start` / `trace` / `stop` tools wrap (registry +
 * onAfterWrite wiring + tracer attach + tracer finalize).
 *
 * The MCP server itself is a thin handler over the session manager; testing
 * via stdio would require an MCP client harness and would mostly verify the
 * @modelcontextprotocol/sdk wiring, not termless behaviour. The session
 * manager is the load-bearing piece.
 *
 * Tests inject a stub `renderFn` to `createFrameTracer` so we don't pay for
 * ghostty-web WASM init on every assertion (the production path goes through
 * @termless/ghostty's `renderTerminalPng` — verified by the wider canvas
 * render tests).
 *
 * Phase 0.5 step 7 of @km/infra/mcp-tty-ghostty-backend-toggle.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createFrameTracer } from "@termless/core"
import { createSessionManager } from "../src/session.ts"

describe("session manager — FrameTracer integration (MCP tool surface)", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "termless-mcp-trace-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("attachTracer + getTracer + getTraceDir round-trip", async () => {
    const manager = createSessionManager()
    try {
      // Stub renderer — skips ghostty-web WASM entirely; produces a sentinel
      // 8-byte PNG-ish payload (PNG magic + 4 zero bytes).
      const stubPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])
      const renderFn = async (): Promise<Uint8Array> => stubPng

      let tracer: ReturnType<typeof createFrameTracer> | null = null
      const { id, terminal } = await manager.createSession({
        cols: 40,
        rows: 10,
        onAfterWrite: (data) => tracer?.onWrite(data),
      })
      tracer = createFrameTracer(terminal, { dir, debounceMs: 4, renderFn })
      manager.attachTracer(id, tracer, dir)

      expect(manager.getTracer(id)).toBe(tracer)
      expect(manager.getTraceDir(id)).toBe(dir)
    } finally {
      await manager.stopAll()
    }
  })

  test("getTracer returns null when no tracer attached", async () => {
    const manager = createSessionManager()
    try {
      const { id } = await manager.createSession({ cols: 40, rows: 10 })
      expect(manager.getTracer(id)).toBeNull()
      expect(manager.getTraceDir(id)).toBeNull()
    } finally {
      await manager.stopAll()
    }
  })

  test("getTracer throws for unknown session id", async () => {
    const manager = createSessionManager()
    try {
      expect(() => manager.getTracer("session-nope")).toThrow(/Session not found/)
      expect(() => manager.getTraceDir("session-nope")).toThrow(/Session not found/)
    } finally {
      await manager.stopAll()
    }
  })

  test("onAfterWrite → tracer.onWrite → frame captured + persisted", async () => {
    const manager = createSessionManager()
    try {
      const stubPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      const renderFn = async (): Promise<Uint8Array> => stubPng

      let tracer: ReturnType<typeof createFrameTracer> | null = null
      const { id, terminal } = await manager.createSession({
        cols: 40,
        rows: 10,
        onAfterWrite: (data) => tracer?.onWrite(data),
      })
      tracer = createFrameTracer(terminal, { dir, debounceMs: 4, renderFn })
      manager.attachTracer(id, tracer, dir)

      // Feed ANSI — should propagate through onAfterWrite to tracer.onWrite,
      // schedule a debounced capture, and persist.
      terminal.feed("\x1b[2J\x1b[Hhello")

      // Wait past debounce window.
      await new Promise((resolve) => setTimeout(resolve, 60))

      // Pull frames since seq 0.
      const frames = tracer.framesSinceSeq(0)
      expect(frames.length).toBeGreaterThanOrEqual(1)
      const first = frames[0]!
      expect(first.seq).toBe(1)
      expect(first.hash).toBeTruthy()
      expect(first.duplicate_of).toBeNull()
      expect(first.png).toMatch(/^00001\.png$/)
      expect(first.buffer.cols).toBe(40)

      // PNG written to dir.
      const pngs = readdirSync(dir).filter((f) => f.endsWith(".png"))
      expect(pngs).toContain("00001.png")

      // index.jsonl exists + parses.
      const indexPath = join(dir, "index.jsonl")
      const lines = readFileSync(indexPath, "utf-8").trim().split("\n")
      expect(lines.length).toBeGreaterThanOrEqual(1)
      for (const line of lines) {
        const parsed = JSON.parse(line)
        expect(parsed.seq).toBeGreaterThanOrEqual(1)
        expect(parsed.hash).toBeTruthy()
      }

      const summary = await tracer.stop()
      expect(summary.count).toBeGreaterThanOrEqual(1)
      expect(summary.uniqueCount).toBeGreaterThanOrEqual(1)
      expect(summary.indexFile).toBe(indexPath)
    } finally {
      await manager.stopAll()
    }
  })

  test("framesSinceSeq advances cursor based on caller-supplied seq", async () => {
    const manager = createSessionManager()
    try {
      const stubPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])
      const renderFn = async (): Promise<Uint8Array> => stubPng

      let tracer: ReturnType<typeof createFrameTracer> | null = null
      const { id, terminal } = await manager.createSession({
        cols: 40,
        rows: 10,
        onAfterWrite: (data) => tracer?.onWrite(data),
      })
      tracer = createFrameTracer(terminal, { dir, debounceMs: 4, renderFn })
      manager.attachTracer(id, tracer, dir)

      // Three distinct frames.
      terminal.feed("\x1b[2J\x1b[Hfirst")
      await new Promise((resolve) => setTimeout(resolve, 60))
      terminal.feed("\x1b[2J\x1b[Hsecond")
      await new Promise((resolve) => setTimeout(resolve, 60))
      terminal.feed("\x1b[2J\x1b[Hthird")
      await new Promise((resolve) => setTimeout(resolve, 60))

      const all = tracer.framesSinceSeq(0)
      expect(all.length).toBe(3)

      // Cursor at seq 1 returns frames 2 + 3.
      const sinceSeq1 = tracer.framesSinceSeq(1)
      expect(sinceSeq1.length).toBe(2)
      expect(sinceSeq1[0]!.seq).toBe(2)

      // Cursor at seq 3 returns empty (caller saw everything).
      const sinceSeq3 = tracer.framesSinceSeq(3)
      expect(sinceSeq3.length).toBe(0)

      await tracer.stop()
    } finally {
      await manager.stopAll()
    }
  })

  test("session without onAfterWrite ignores tracer writes (no wiring)", async () => {
    const manager = createSessionManager()
    try {
      const stubPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])
      const renderFn = async (): Promise<Uint8Array> => stubPng

      // Session created WITHOUT onAfterWrite — tracer is attached but the
      // hook isn't wired, so writes don't reach the tracer.
      const { id, terminal } = await manager.createSession({ cols: 40, rows: 10 })
      const tracer = createFrameTracer(terminal, { dir, debounceMs: 4, renderFn })
      manager.attachTracer(id, tracer, dir)

      terminal.feed("\x1b[2J\x1b[Hsilent")
      await new Promise((resolve) => setTimeout(resolve, 60))

      // No frames captured — the onWrite hook was never invoked.
      expect(tracer.count).toBe(0)

      await tracer.stop()
    } finally {
      await manager.stopAll()
    }
  })

  test("terminal.screenshotSvg() produces SVG (sanity — auto-picker SVG branch)", async () => {
    // Sanity check that the SVG output path the MCP `screenshot` tool falls
    // through to (when format='svg' or .svg outputPath) still works through
    // the session manager. PNG path requires ghostty-web WASM and is
    // covered by the canvas render tests in @termless/ghostty.
    const manager = createSessionManager()
    try {
      const { terminal } = await manager.createSession({ cols: 20, rows: 4 })
      terminal.feed("hello")
      const svg = terminal.screenshotSvg()
      expect(svg).toContain("<svg")
      expect(svg).toContain("hello")
    } finally {
      await manager.stopAll()
    }
  })

  test("stopSession finalizes attached tracer via getTracer→stop pattern", async () => {
    const manager = createSessionManager()
    try {
      const stubPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])
      const renderFn = async (): Promise<Uint8Array> => stubPng

      let tracer: ReturnType<typeof createFrameTracer> | null = null
      const { id, terminal } = await manager.createSession({
        cols: 40,
        rows: 10,
        onAfterWrite: (data) => tracer?.onWrite(data),
      })
      tracer = createFrameTracer(terminal, { dir, debounceMs: 4, renderFn })
      manager.attachTracer(id, tracer, dir)

      terminal.feed("\x1b[2J\x1b[Hbye")
      await new Promise((resolve) => setTimeout(resolve, 60))

      // The MCP `stop` tool pattern: tracer.stop() → sessions.stopSession().
      const tracerRef = manager.getTracer(id)
      expect(tracerRef).not.toBeNull()
      const summary = await tracerRef!.stop()
      await manager.stopSession(id)

      expect(summary.count).toBeGreaterThanOrEqual(1)
      expect(summary.truncated).toBe(false)
      // Session is gone post-stop.
      expect(() => manager.getSession(id)).toThrow(/Session not found/)
    } finally {
      await manager.stopAll()
    }
  })
})
