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

import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
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
  /** The renderer for raster output (`canvas` / `resvg` / `swash` / `auto`). */
  renderer: "canvas" | "resvg" | "swash" | "auto"
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
 * Write a `.tape` from the captured input events. `eventsToTape` is supplied by
 * the caller (it lives in `record-cmd.ts` alongside the key-mapping table).
 */
function writeTape(path: string, session: CapturedSession, eventsToTape: (s: CapturedSession) => string): void {
  writeFileSync(path, eventsToTape(session))
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
    writeFileSync(path, await rasterizer.toPng(last.svg, 2))
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
export async function writeOutputs(
  targets: readonly OutputTarget[],
  session: CapturedSession,
  eventsToTape: (s: CapturedSession) => string,
): Promise<Array<{ path: string; bytes: number }>> {
  const written: Array<{ path: string; bytes: number }> = []
  for (const target of targets) {
    mkdirSync(dirname(resolve(target.path)), { recursive: true })
    switch (target.format) {
      case "cast":
        writeCast(target.path, session)
        break
      case "tape":
        writeTape(target.path, session, eventsToTape)
        break
      case "rec":
        await writeRec(target.path, session)
        break
      default:
        await writeImage(target.path, target.format, session)
        break
    }
    written.push({ path: target.path, bytes: statSync(resolve(target.path)).size })
  }
  return written
}
