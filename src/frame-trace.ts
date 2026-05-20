/**
 * Frame-trace mode for termless.
 *
 * Captures every render-relevant buffer mutation with timestamp + content
 * hash + (optional) PNG. Designed to make visual bugs investigable:
 * "the border disappeared after frame 47" instead of "looks wrong somewhere".
 *
 * Phase 2 of the Visual Eyes epic (@km/infra/mcp-tty-ghostty-backend-toggle).
 *
 * Usage (consumer-side, e.g., mcp__tty plugin):
 *   const tracer = createFrameTracer(terminal, { dir: "/tmp/trace-1/" })
 *   // ... terminal runs ...
 *   const summary = await tracer.stop()
 *   // tracer.framesSinceSeq(0) returns the full trace
 *
 * Output layout:
 *   /tmp/trace-1/
 *     index.jsonl    — append-only, one Frame per line; tolerant to truncation
 *     00001.png      — unique frames only; duplicates point to original via duplicate_of
 *     00002.png
 *     ...
 *     viewer.html    — self-contained HTML trace viewer, written on stop()
 *
 * The tracer hooks into `terminal.onAfterWrite` (wired via TerminalCreateOptions)
 * and debounces frame captures by `debounceMs` so we get one frame per render
 * pass rather than one per cell-write.
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { writeViewer } from "./frame-viewer.ts"
import type { ScreenshotOptions, Terminal } from "./types.ts"

export interface FrameTraceOptions {
  /** Output directory. Created if missing. */
  dir: string
  /** Debounce interval. Default: 16ms (one render frame at 60fps). */
  debounceMs?: number
  /** Hard cap on frames captured. Default: 10_000. */
  maxFrames?: number
  /** Skip writing PNGs for duplicate hashes (still records in index). Default: true. */
  dedupe?: boolean
  /** Override canvas-render options forwarded to @termless/ghostty's renderTerminalPng. */
  canvas?: Pick<ScreenshotOptions, "cols" | "rows" | "fontSize" | "fontPath" | "theme" | "dpr">
  /**
   * If provided, called instead of `@termless/ghostty.renderTerminalPng` to
   * produce the frame PNG bytes. Useful for tests that don't want to spin up
   * the native canvas renderer / WASM.
   */
  renderFn?: (terminal: Terminal) => Promise<Uint8Array>
}

export interface Frame {
  seq: number
  ts: number
  iso: string
  hash: string
  duplicate_of: number | null
  bytes_in_since_last: number
  ansi_input_preview: string
  buffer: {
    cols: number
    rows: number
    cursor: { row: number; col: number }
  }
  duration_since_prev_ms: number
  render_ms: number
  png: string | null
  /**
   * Optional silvery render-state snapshot. Populated by Phase 4 of the
   * Visual Eyes epic; absent on traces recorded without a silvery hook.
   * The viewer renders it when present and omits the section when absent.
   */
  silvery?: unknown
}

export interface FrameTraceSummary {
  count: number
  uniqueCount: number
  duplicateRatio: number
  totalBytes: number
  indexFile: string
  firstTs: number | null
  lastTs: number | null
  truncated: boolean
}

export interface FrameTracer {
  /** Hook to register with Terminal's `onAfterWrite`. */
  readonly onWrite: (data: Uint8Array) => void
  /** All frames recorded so far. */
  framesSinceSeq(seq: number): Frame[]
  /** Frames recorded at or after `ts` (ms epoch). */
  framesSinceTime(ts: number): Frame[]
  /** Flush pending debounced frame, close index file, return summary. */
  stop(): Promise<FrameTraceSummary>
  /** Was the trace truncated by maxFrames cap. */
  readonly truncated: boolean
  /** Total frames recorded (unique + duplicate). */
  readonly count: number
}

// ── Hash helper: prefers Bun.hash.xxHash64 for speed; falls back to a
//    simple FNV-1a (deterministic, dep-free) otherwise. xxHash3 collision rate
//    is fine for "is this the same buffer state" over the typical 10k-frame
//    trace lifetime.

function hashBytes(bytes: Uint8Array | string): string {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes
  const bunHash = (globalThis as { Bun?: { hash?: { xxHash64?: (b: Uint8Array) => bigint } } }).Bun?.hash?.xxHash64
  if (bunHash) {
    return `xxh64:${bunHash(data).toString(16)}`
  }
  // FNV-1a 64-bit fallback.
  let h = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = (1n << 64n) - 1n
  for (let i = 0; i < data.length; i++) {
    h ^= BigInt(data[i] ?? 0)
    h = (h * prime) & mask
  }
  return `fnv1a:${h.toString(16)}`
}

function bufferFingerprint(terminal: Terminal): {
  hash: string
  cols: number
  rows: number
  cursorRow: number
  cursorCol: number
} {
  const lines = terminal.getLines()
  // Hash visible text per row + cursor position. Lightweight enough to call
  // on every debounced tick; differentiates render passes that change attrs
  // too (cellsToAnsi-like serialization could be heavier but more precise).
  const lineStrs: string[] = []
  for (const row of lines) {
    let s = ""
    for (const cell of row) {
      // Mix in char + a 1-byte attribute digest so attribute-only changes still
      // produce a new hash.
      const attrs =
        (cell.bold ? 1 : 0) |
        (cell.dim ? 2 : 0) |
        (cell.italic ? 4 : 0) |
        (cell.underline ? 8 : 0) |
        (cell.inverse ? 16 : 0) |
        (cell.strikethrough ? 32 : 0)
      const fg = cell.fg ? `${cell.fg.r},${cell.fg.g},${cell.fg.b}` : ""
      const bg = cell.bg ? `${cell.bg.r},${cell.bg.g},${cell.bg.b}` : ""
      s += `${cell.char}|${attrs}|${fg}|${bg};`
    }
    lineStrs.push(s)
  }
  const cursor = (() => {
    try {
      return terminal.getCursor()
    } catch {
      return { x: 0, y: 0, visible: true, style: "block" as const }
    }
  })()
  return {
    hash: hashBytes(lineStrs.join("\n")),
    cols: lines[0]?.length ?? 0,
    rows: lines.length,
    cursorRow: cursor.y,
    cursorCol: cursor.x,
  }
}

function previewAnsi(bytes: Uint8Array, maxLen = 80): string {
  const text = new TextDecoder().decode(bytes)
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + "…"
}

function padSeq(n: number, width = 5): string {
  return n.toString().padStart(width, "0")
}

export function createFrameTracer(terminal: Terminal, options: FrameTraceOptions): FrameTracer {
  const debounceMs = options.debounceMs ?? 16
  const maxFrames = options.maxFrames ?? 10_000
  const dedupe = options.dedupe ?? true
  const dir = options.dir
  // Default renderer: route through @termless/ghostty's renderTerminalPng.
  // Dynamic import keeps @termless/core install-independent of @termless/ghostty;
  // a missing module surfaces from the import itself, not from a top-level
  // dependency. Tests inject `renderFn` to avoid the WASM cost entirely.
  const renderFn =
    options.renderFn ??
    (async (t: Terminal): Promise<Uint8Array> => {
      const { renderTerminalPng } = (await import("@termless/ghostty")) as {
        renderTerminalPng: (term: Terminal, opts?: unknown) => Promise<Uint8Array>
      }
      return renderTerminalPng(t, options.canvas)
    })

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const indexFile = join(dir, "index.jsonl")
  // Truncate any prior index for this dir.
  appendFileSync(indexFile, "", { flag: "w" })

  const frames: Frame[] = []
  const hashToSeq = new Map<string, number>()
  let pendingTimer: ReturnType<typeof setTimeout> | null = null
  let bytesSinceLast = 0
  let lastAnsiPreview = ""
  let lastTs: number | null = null
  let firstTs: number | null = null
  let truncated = false
  let stopped = false

  function flushPending(): void {
    if (pendingTimer) {
      clearTimeout(pendingTimer)
      pendingTimer = null
    }
  }

  async function captureFrame(): Promise<void> {
    if (stopped) return
    if (frames.length >= maxFrames) {
      truncated = true
      return
    }
    const ts = Date.now()
    const renderStart = performance.now()
    const fp = bufferFingerprint(terminal)
    const seq = frames.length + 1
    const existing = hashToSeq.get(fp.hash)
    const duplicate_of = existing ?? null
    let pngRelPath: string | null = null
    let renderMs = 0
    if (existing == null) {
      // Unique frame — write the PNG.
      try {
        const png = await renderFn(terminal)
        const fname = `${padSeq(seq)}.png`
        await writeFile(join(dir, fname), png)
        pngRelPath = fname
        renderMs = +(performance.now() - renderStart).toFixed(2)
        hashToSeq.set(fp.hash, seq)
      } catch (err) {
        // Don't kill the trace — record the frame without PNG and continue.
        renderMs = +(performance.now() - renderStart).toFixed(2)
        // eslint-disable-next-line no-console
        console.error("[frame-trace] render failed:", (err as Error).message)
      }
    } else if (!dedupe) {
      // Forced re-render even though hash matches.
      const png = await renderFn(terminal)
      const fname = `${padSeq(seq)}.png`
      await writeFile(join(dir, fname), png)
      pngRelPath = fname
      renderMs = +(performance.now() - renderStart).toFixed(2)
    }
    const durSincePrev = lastTs == null ? 0 : ts - lastTs
    const frame: Frame = {
      seq,
      ts,
      iso: new Date(ts).toISOString(),
      hash: fp.hash,
      duplicate_of,
      bytes_in_since_last: bytesSinceLast,
      ansi_input_preview: lastAnsiPreview,
      buffer: {
        cols: fp.cols,
        rows: fp.rows,
        cursor: { row: fp.cursorRow, col: fp.cursorCol },
      },
      duration_since_prev_ms: durSincePrev,
      render_ms: renderMs,
      png: pngRelPath,
    }
    frames.push(frame)
    appendFileSync(indexFile, JSON.stringify(frame) + "\n")
    if (firstTs == null) firstTs = ts
    lastTs = ts
    bytesSinceLast = 0
    lastAnsiPreview = ""
  }

  function scheduleCapture(): void {
    if (stopped || truncated) return
    if (pendingTimer) clearTimeout(pendingTimer)
    pendingTimer = setTimeout(() => {
      pendingTimer = null
      void captureFrame()
    }, debounceMs)
  }

  function onWrite(data: Uint8Array): void {
    bytesSinceLast += data.byteLength
    if (lastAnsiPreview === "") lastAnsiPreview = previewAnsi(data)
    scheduleCapture()
  }

  async function stop(): Promise<FrameTraceSummary> {
    if (pendingTimer) {
      clearTimeout(pendingTimer)
      pendingTimer = null
      // Flush one final frame if writes were pending.
      await captureFrame()
    }
    stopped = true
    const uniqueCount = hashToSeq.size
    const count = frames.length
    const totalBytes = frames.reduce((acc, f) => acc + f.bytes_in_since_last, 0)
    // Emit a self-contained HTML viewer alongside the trace so every trace is
    // immediately inspectable by double-clicking viewer.html — no server.
    // Never let a viewer-generation failure kill the trace summary.
    try {
      writeViewer(dir)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[frame-trace] viewer generation failed:", (err as Error).message)
    }
    return {
      count,
      uniqueCount,
      duplicateRatio: count === 0 ? 0 : 1 - uniqueCount / count,
      totalBytes,
      indexFile,
      firstTs,
      lastTs,
      truncated,
    }
  }

  return {
    onWrite,
    framesSinceSeq(seq: number) {
      return frames.filter((f) => f.seq > seq)
    },
    framesSinceTime(ts: number) {
      return frames.filter((f) => f.ts >= ts)
    },
    stop,
    get truncated() {
      return truncated
    },
    get count() {
      return frames.length
    },
  }
}
