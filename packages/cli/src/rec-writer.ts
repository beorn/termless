/**
 * `termless record` output writers — turn one captured session into each
 * requested {@link OutputTarget}.
 *
 * A `record` run captures three things: keyboard input events, terminal output
 * events, and a sequence of SVG frames. Every output format is a *projection*
 * of that one capture:
 *
 * | Format          | Source                | Renderer                          |
 * | --------------- | --------------------- | --------------------------------- |
 * | `.gif` `.apng`  | SVG frames            | raster — `canvas` → `resvg`        |
 * | `.png`          | last SVG frame        | raster — `canvas` → `resvg`        |
 * | `.svg`          | SVG frames            | none (vector)                     |
 * | `.html`         | SVG frames            | none (browser viewer at view-time) |
 * | `.rec`          | SVG frames + io       | the native single-file container  |
 * | `.cast`         | io events             | none (asciicast)                  |
 * | `.tape`         | input events          | none                              |
 */

import { createHash } from "node:crypto"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, extname, join, relative, resolve } from "node:path"
import type { AnimationFrame } from "../../../src/view/animation-types.ts"
import type { OutputFormat, OutputTarget } from "./output-targets.ts"

/** One captured `record` session — the single source every output projects from. */
export interface CapturedSession {
  /** Terminal columns the session ran at. */
  cols: number
  /** Terminal rows the session ran at. */
  rows: number
  /** Total session duration in milliseconds. */
  durationMs: number
  /** The command that was recorded (for `.cast` / `.tape` metadata). */
  command: string[]
  /** Keyboard input events, ordered by `time` (ms from start). */
  inputEvents: Array<{ time: number; bytes: Uint8Array }>
  /** Terminal output events, ordered by `time` (ms from start). */
  outputEvents: Array<{ time: number; data: string }>
  /** Captured SVG frames with per-frame display durations. */
  frames: AnimationFrame[]
  /** The renderer for raster output (`canvas` / `resvg` / `swash` / `browser` / `auto`). */
  renderer: "canvas" | "resvg" | "swash" | "browser" | "auto"
}

// =============================================================================
// .cast — asciicast v2
// =============================================================================

function writeCast(path: string, session: CapturedSession): void {
  const header = JSON.stringify({
    version: 2,
    width: session.cols,
    height: session.rows,
    timestamp: Math.floor(Date.now() / 1000),
    duration: session.durationMs / 1000,
    env: { SHELL: session.command[0] ?? "", TERM: "xterm-256color" },
  })
  const events: Array<[number, string, string]> = []
  for (const e of session.outputEvents) events.push([e.time / 1000, "o", e.data])
  for (const e of session.inputEvents) events.push([e.time / 1000, "i", new TextDecoder().decode(e.bytes)])
  events.sort((a, b) => a[0] - b[0])
  writeFileSync(path, [header, ...events.map((e) => JSON.stringify(e))].join("\n") + "\n")
}

// =============================================================================
// .tape — VHS-style tape from the input events
// =============================================================================

/**
 * Context passed to the tape serializer for target-specific header settings.
 */
export interface TapeWriteContext {
  target: OutputTarget
  tape?: {
    framesDir?: string
    frameDebounceMs?: number
  }
}

export interface OutputFrameTraceOptions {
  enabled?: boolean
  dir?: string
  frameDebounceMs?: number
  renderFramePng?: (frame: AnimationFrame, index: number, session: CapturedSession) => Promise<Uint8Array>
}

/** Options controlling extra sidecars emitted by {@link writeOutputs}. */
export interface WriteOutputsOptions {
  frameTrace?: OutputFrameTraceOptions
}

/** Derive the default `<name>.frames` sidecar directory for a `.tape` target. */
export function tapeFrameTraceDir(tapePath: string): string {
  const ext = extname(tapePath)
  const base = ext.length > 0 ? basename(tapePath, ext) : basename(tapePath)
  return join(dirname(tapePath), `${base}.frames`).replaceAll("\\", "/")
}

function tapeFramesSetting(tapePath: string, framesDir: string): string {
  let rel = relative(dirname(resolve(tapePath)), resolve(framesDir)).replaceAll("\\", "/")
  if (rel === "") return "."
  if (!rel.startsWith(".") && !rel.startsWith("/")) rel = `./${rel}`
  return rel
}

function frameHash(frame: AnimationFrame): string {
  return createHash("sha1").update(frame.svg).digest("hex")
}

function frameCursor(frame: AnimationFrame): { row: number; col: number } {
  try {
    const cursor = frame.snapshot?.getCursor()
    return { row: cursor?.y ?? 0, col: cursor?.x ?? 0 }
  } catch {
    return { row: 0, col: 0 }
  }
}

function frameColsRows(frame: AnimationFrame, session: CapturedSession): { cols: number; rows: number } {
  const snapshot = frame.snapshot
  if (!snapshot) return { cols: session.cols, rows: session.rows }
  try {
    const rows = snapshot.getScrollback().screenLines
    const cols = snapshot.getLines().at(-1)?.length ?? session.cols
    return { cols, rows }
  } catch {
    return { cols: session.cols, rows: session.rows }
  }
}

/**
 * Write a complete frame-trace sidecar from the frames already captured by
 * `record`. The trace is target-derived output, so it intentionally reuses the
 * post-frame-gate session frames instead of subscribing to the live terminal.
 */
export async function writeFrameTraceSidecar(
  dir: string,
  session: CapturedSession,
  options: OutputFrameTraceOptions = {},
): Promise<void> {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  const { selectRasterizer } = await import("../../../src/view/rasterizer.ts")
  const rasterizer = options.renderFramePng ? null : await selectRasterizer(session.renderer)
  const hashToSeq = new Map<string, number>()
  const lines: string[] = []
  const baseTs = Date.now()
  let elapsedMs = 0

  try {
    for (let index = 0; index < session.frames.length; index++) {
      const frame = session.frames[index]!
      const seq = index + 1
      const hash = frameHash(frame)
      const duplicateOf = hashToSeq.get(hash) ?? null
      let png: string | null = null
      let renderMs = 0

      if (duplicateOf === null) {
        const started = performance.now()
        const bytes = options.renderFramePng
          ? await options.renderFramePng(frame, index, session)
          : await rasterizer!.toPng(frame.svg, 2)
        renderMs = +(performance.now() - started).toFixed(2)
        png = `${String(seq).padStart(5, "0")}.png`
        writeFileSync(join(dir, png), bytes)
        hashToSeq.set(hash, seq)
      }

      const ts = baseTs + elapsedMs
      lines.push(
        JSON.stringify({
          seq,
          ts,
          iso: new Date(ts).toISOString(),
          hash,
          duplicate_of: duplicateOf,
          bytes_in_since_last: 0,
          ansi_input_preview: "",
          buffer: { ...frameColsRows(frame, session), cursor: frameCursor(frame) },
          duration_since_prev_ms: index === 0 ? 0 : session.frames[index - 1]!.duration,
          render_ms: renderMs,
          png,
        }),
      )
      elapsedMs += frame.duration
    }
  } finally {
    await rasterizer?.dispose?.()
  }

  writeFileSync(join(dir, "index.jsonl"), lines.join("\n") + (lines.length > 0 ? "\n" : ""))
  try {
    const { writeViewer } = await import("../../../src/view/viewer.ts")
    writeViewer(dir)
  } catch {
    // The trace itself is the contract; viewer generation is best-effort.
  }
}

function frameTraceOptionsForTape(
  target: OutputTarget,
  options: OutputFrameTraceOptions | undefined,
): OutputFrameTraceOptions | null {
  if (!options || options.enabled === false) return null
  return { ...options, dir: options.dir ?? tapeFrameTraceDir(target.path) }
}

/**
 * Write a `.tape` from the captured input events. `eventsToTape` is supplied by
 * the caller (it lives in `record-cmd.ts` alongside the key-mapping table).
 */
function writeTape(
  path: string,
  session: CapturedSession,
  eventsToTape: (s: CapturedSession, context?: TapeWriteContext) => string,
  context: TapeWriteContext,
): void {
  writeFileSync(path, eventsToTape(session, context))
}

// =============================================================================
// .rec — native single-file container (frames + io)
// =============================================================================

/**
 * Write a single `.rec` file from the captured session.
 *
 * The SVG frames are rasterized to PNGs (via the session's renderer) into a
 * temp directory, projected into a frames {@link "../../../src/recording/recording.ts".Recording},
 * and serialized with `writeRecording`. The io track is carried alongside.
 */
async function writeRec(path: string, session: CapturedSession): Promise<void> {
  const { createRecording, micros } = await import("../../../src/recording/recording.ts")
  const { fingerprintFromCanvas } = await import("../../../src/recording/frame-trace-recording.ts")
  const { writeRecording } = await import("../../../src/recording/native/native-rec.ts")
  const { selectRasterizer } = await import("../../../src/view/rasterizer.ts")

  const fingerprint = fingerprintFromCanvas("ghostty")
  const pngDir = mkdtempSync(join(tmpdir(), "termless-rec-png-"))
  try {
    const rasterizer = session.frames.length > 0 ? await selectRasterizer(session.renderer) : null
    const modelFrames = []
    let at = 0
    for (let i = 0; i < session.frames.length; i++) {
      const frame = session.frames[i]!
      const pngName = `${String(i + 1).padStart(5, "0")}.png`
      const png = await rasterizer!.toPng(frame.svg, 2)
      writeFileSync(join(pngDir, pngName), png)
      modelFrames.push({
        seq: i + 1,
        at: micros(at * 1000),
        contentHash: `frame-${i + 1}`,
        duplicateOf: null,
        fingerprint,
        buffer: { cols: session.cols, rows: session.rows, cursor: { row: 0, col: 0 } },
        ansiPreview: "",
        bytesInSinceLast: 0,
        png: pngName,
      })
      at += frame.duration
    }
    // Release the headless-Chromium instance the `browser` renderer holds.
    await rasterizer?.dispose?.()

    const io = session.outputEvents.map((e) => ({
      at: micros(e.time * 1000),
      direction: "out" as const,
      data: e.data,
    }))

    const recording = createRecording({
      cols: session.cols,
      rows: session.rows,
      durationMicros: micros(session.durationMs * 1000),
      ...(modelFrames.length > 0 ? { frames: modelFrames } : {}),
      ...(io.length > 0 ? { io } : {}),
      provenance: { reproducible: false },
    })
    writeRecording(path, recording, { pngSourceDir: pngDir })
  } finally {
    rmSync(pngDir, { recursive: true, force: true })
  }
}

// =============================================================================
// raster / vector image outputs
// =============================================================================

async function writeImage(path: string, format: OutputFormat, session: CapturedSession): Promise<void> {
  if (session.frames.length === 0) {
    throw new Error(`record: no frames captured — cannot write ${path}`)
  }
  if (format === "gif") {
    const { createGif } = await import("../../../src/view/gif.ts")
    writeFileSync(path, await createGif(session.frames, { renderer: session.renderer }))
    return
  }
  if (format === "apng") {
    const { createApng } = await import("../../../src/view/apng.ts")
    writeFileSync(path, await createApng(session.frames, { renderer: session.renderer }))
    return
  }
  if (format === "svg") {
    const { createAnimatedSvg } = await import("../../../src/view/animated-svg.ts")
    writeFileSync(path, createAnimatedSvg(session.frames), "utf-8")
    return
  }
  if (format === "png") {
    // A single still — the last frame, rasterized via the renderer.
    const { selectRasterizer } = await import("../../../src/view/rasterizer.ts")
    const rasterizer = await selectRasterizer(session.renderer)
    const last = session.frames[session.frames.length - 1]!
    try {
      writeFileSync(path, await rasterizer.toPng(last.svg, 2))
    } finally {
      await rasterizer.dispose?.()
    }
    return
  }
  if (format === "html") {
    // A self-contained scrubbable browser viewer — written through a temp
    // `.rec` so the viewer reads the same frame projection `view` would.
    const { writeViewer } = await import("../../../src/view/viewer.ts")
    const { unpackRecording } = await import("../../../src/recording/native/native-rec.ts")
    const tmpRecDir = mkdtempSync(join(tmpdir(), "termless-html-"))
    const tmpRec = join(tmpRecDir, "session.rec")
    const tmpDir = mkdtempSync(join(tmpdir(), "termless-html-dir-"))
    try {
      await writeRec(tmpRec, session)
      unpackRecording(tmpRec, tmpDir)
      const result = writeViewer(join(tmpDir, "frames"))
      copyFileSync(result.viewerFile, path)
    } finally {
      rmSync(tmpRecDir, { recursive: true, force: true })
      rmSync(tmpDir, { recursive: true, force: true })
    }
    return
  }
  throw new Error(`record: ${format} is not an image format`)
}

// =============================================================================
// Dispatch
// =============================================================================

/**
 * Write every requested {@link OutputTarget} from one {@link CapturedSession}.
 *
 * @returns The written paths with their byte sizes, for the `✓` summary.
 */
/**
 * Per-target progress hook. The recorder uses this to draw a "writing N
 * files..." progress block in the host terminal AFTER it has torn down the
 * live overlay — so the user can see writes happening on the normal screen
 * instead of staring at a frozen recording overlay.
 *
 * `phase: "start"` fires just before the file is written.
 * `phase: "done"`  fires after the file is written, with `bytes` populated.
 */
export interface WriteOutputsProgress {
  (event: { phase: "start" | "done"; target: OutputTarget; index: number; total: number; bytes?: number }): void
}

export async function writeOutputs(
  targets: readonly OutputTarget[],
  session: CapturedSession,
  eventsToTape: (s: CapturedSession, context?: TapeWriteContext) => string,
  onProgress?: WriteOutputsProgress,
  options: WriteOutputsOptions = {},
): Promise<Array<{ path: string; bytes: number }>> {
  const written: Array<{ path: string; bytes: number }> = []
  const writtenTraceDirs = new Set<string>()
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i]!
    onProgress?.({ phase: "start", target, index: i, total: targets.length })
    mkdirSync(dirname(resolve(target.path)), { recursive: true })
    switch (target.format) {
      case "cast":
        writeCast(target.path, session)
        break
      case "tape":
        {
          const frameTrace = frameTraceOptionsForTape(target, options.frameTrace)
          const framesDir = frameTrace?.dir
          const context: TapeWriteContext = {
            target,
            ...(framesDir
              ? {
                  tape: {
                    framesDir: tapeFramesSetting(target.path, framesDir),
                    ...(frameTrace.frameDebounceMs !== undefined
                      ? { frameDebounceMs: frameTrace.frameDebounceMs }
                      : {}),
                  },
                }
              : {}),
          }
          writeTape(target.path, session, eventsToTape, context)
          if (frameTrace?.dir) {
            const resolvedDir = resolve(frameTrace.dir)
            if (!writtenTraceDirs.has(resolvedDir)) {
              await writeFrameTraceSidecar(frameTrace.dir, session, frameTrace)
              writtenTraceDirs.add(resolvedDir)
            }
          }
        }
        break
      case "rec":
        await writeRec(target.path, session)
        break
      default:
        await writeImage(target.path, target.format, session)
        break
    }
    const bytes = statSync(resolve(target.path)).size
    onProgress?.({ phase: "done", target, index: i, total: targets.length, bytes })
    written.push({ path: target.path, bytes })
  }
  return written
}
