/**
 * The native `.trec` recording format — termless's canonical full-fidelity
 * on-disk form for a {@link Recording}.
 *
 * Phase 5 of the Recording-domain unification (design doc §4, §6). `.trec`
 * supersedes the ad-hoc `recording.ts` JSON and the bare frame-trace directory
 * with **one canonical format** that carries all three Recording members
 * losslessly.
 *
 * ## Shape — a directory bundle
 *
 * `.trec` is a **directory**, never a base64-in-JSON single file (a long trace
 * base64'd into one JSON is a 100 MB OOM / `git diff`-breaking monster):
 *
 * ```
 * mysession.trec/
 *   manifest.json                 — metadata, Renderer fingerprint, track index,
 *                                   format version
 *   commands.jsonl                — the commands source track  (omitted if absent)
 *   io.jsonl                      — the io source track        (omitted if absent)
 *   frames/index.jsonl + NNNNN.png — the frames projection      (omitted if absent)
 * ```
 *
 * ## Superset of the frame-trace layout
 *
 * The `frames/` subtree is **byte-identical to the frame-trace directory
 * layout** ({@link "./frame-trace.ts"}'s `index.jsonl` + `NNNNN.png`). An
 * existing km golden trace directory IS a valid `.trec` `frames/` subtree —
 * {@link readRecording} loads a bare legacy frame-trace directory (no
 * `manifest.json`, just `index.jsonl` + PNGs) as a frames-only Recording.
 * That superset relationship is what keeps every km golden valid across the
 * Phase 5 format change.
 *
 * ## Portable single-file archive
 *
 * {@link packRecording} zips a `.trec` directory into a portable single-file
 * `.trec` archive (like `.docx` / `.epub`); {@link unpackRecording} expands it
 * back. The archive path is optional — the directory is the default.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import type { Frame as TraceFrame } from "./frame-trace.ts"
import { traceToRecording } from "./frame-trace-recording.ts"
import {
  type Command,
  type IoEvent,
  type Recording,
  type RendererFingerprint,
  createRecording,
  micros,
} from "./recording-model.ts"
import { buildZip, parseZip, type ZipEntry } from "./zip-archive.ts"

/** The `.trec` format version written into every `manifest.json`. */
export const TREC_FORMAT_VERSION = 1

/** File name of the manifest within a `.trec` directory. */
const MANIFEST_FILE = "manifest.json"
/** File name of the commands track within a `.trec` directory. */
const COMMANDS_FILE = "commands.jsonl"
/** File name of the io track within a `.trec` directory. */
const IO_FILE = "io.jsonl"
/** Sub-directory holding the frames projection within a `.trec` directory. */
const FRAMES_DIR = "frames"
/** Index file within the `frames/` sub-directory. */
const FRAMES_INDEX = "index.jsonl"

// =============================================================================
// manifest.json
// =============================================================================

/**
 * The `manifest.json` of a `.trec` directory — metadata about the recording
 * plus an index of which track files are present.
 *
 * The manifest is the marker that distinguishes a full `.trec` directory from
 * a bare legacy frame-trace directory: when it is absent, {@link readRecording}
 * falls back to the frames-only legacy path.
 */
export interface TrecManifest {
  /** The `.trec` format version — {@link TREC_FORMAT_VERSION}. */
  trecVersion: number
  /** Recording-model version (currently always `1`). */
  recordingVersion: 1
  /** Terminal columns at recording start. */
  cols: number
  /** Terminal rows at recording start. */
  rows: number
  /** Total recording duration in integer microseconds. */
  durationMicros: number
  /** Whether the frames projection is regenerable from the io track. */
  reproducible: boolean
  /**
   * Which track files are present in the directory. A reader uses this index
   * to know what to load without probing the filesystem for every track.
   */
  tracks: {
    /** `true` when `commands.jsonl` is present. */
    commands: boolean
    /** `true` when `io.jsonl` is present. */
    io: boolean
    /** `true` when `frames/index.jsonl` is present. */
    frames: boolean
  }
  /**
   * The Renderer fingerprint the frames projection was rendered against, when
   * the recording carries a frames projection. Absent for a frames-less
   * recording. Lifted from the first frame — the frame-trace layout stamps one
   * trace-wide fingerprint.
   */
  fingerprint?: RendererFingerprint
}

// =============================================================================
// Options
// =============================================================================

/** Options for {@link writeRecording}. */
export interface WriteRecordingOptions {
  /**
   * Directory the frames projection's PNGs are copied *from*. Each frame's
   * `png` field is a relative filename resolved against this directory; the
   * resolved PNG is copied into the `.trec` `frames/` sub-directory under the
   * same name. Omit when the recording carries no PNGs (every frame's `png` is
   * `null`) or when the PNGs are not available on disk.
   */
  pngSourceDir?: string
}

/** Options for {@link readRecording}. */
export interface ReadRecordingOptions {
  /**
   * Backend id stamped onto the synthesized renderer fingerprint when reading
   * a *bare legacy frame-trace directory* (one with no `manifest.json`). The
   * legacy layout records no backend. Ignored for a full `.trec` directory,
   * which carries the fingerprint in its manifest. Default: `"unknown"`.
   */
  backend?: string
}

// =============================================================================
// JSONL helpers
// =============================================================================

/** Serialize an array of records as JSONL — one JSON object per line. */
function toJsonl(records: readonly unknown[]): string {
  if (records.length === 0) return ""
  return records.map((r) => JSON.stringify(r)).join("\n") + "\n"
}

/**
 * Parse JSONL into an array. Tolerant: blank lines and a malformed final line
 * (a truncated, interrupted write) are skipped — mirroring the append-only,
 * truncation-tolerant design of the frame tracer.
 */
function parseJsonl<T>(text: string): T[] {
  const out: T[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      out.push(JSON.parse(trimmed) as T)
    } catch {
      // Tolerant: skip a malformed (e.g. truncated) line.
    }
  }
  return out
}

// =============================================================================
// Frames projection ⇄ frame-trace `index.jsonl`
// =============================================================================
//
// The `.trec` `frames/` sub-tree is byte-compatible with the frame-trace
// directory layout: `index.jsonl` rows are the on-disk `TraceFrame` shape, not
// the in-memory model `Frame` shape. Writing converts model frames to
// `TraceFrame` rows; reading projects `TraceFrame` rows back via the shared
// `traceToRecording` adapter — the exact same path `loadVisualTrace` uses.

/**
 * Convert a model {@link Recording}'s frames projection back to the on-disk
 * `TraceFrame[]` shape so it can be written into `frames/index.jsonl`.
 *
 * The model dropped the frame-trace-only fields (`iso`, `render_ms`); they are
 * reconstructed deterministically. `ts` is rebuilt from the model's integer-µs
 * `at` (`ts = at / 1000`) so that re-projecting the written frames through
 * {@link traceToRecording} yields a frames projection equal to the original —
 * `traceToRecording` rebases `at = (ts − firstTs) × 1000`, and `firstTs` is 0.
 */
function recordingFramesToTraceFrames(recording: Recording): TraceFrame[] {
  const frames = recording.frames ?? []
  const result: TraceFrame[] = []
  let prevTs: number | null = null
  for (const f of frames) {
    // `at` is integer µs from recording start; the frame-trace `ts` is a
    // ms epoch. With epoch 0 the round-trip is exact: at → ts → at.
    const ts = Math.round(f.at / 1000)
    const trace: TraceFrame = {
      seq: f.seq,
      ts,
      iso: new Date(ts).toISOString(),
      hash: f.contentHash,
      duplicate_of: f.duplicateOf,
      bytes_in_since_last: f.bytesInSinceLast,
      ansi_input_preview: f.ansiPreview,
      buffer: {
        cols: f.buffer.cols,
        rows: f.buffer.rows,
        cursor: { row: f.buffer.cursor.row, col: f.buffer.cursor.col },
      },
      duration_since_prev_ms: prevTs === null ? 0 : ts - prevTs,
      render_ms: 0,
      png: f.png,
    }
    if (f.signal !== undefined) trace.silvery = { type: "RENDER_DISPATCHED", ...f.signal }
    result.push(trace)
    prevTs = ts
  }
  return result
}

// =============================================================================
// In-memory bundle — the `name → bytes` map a `.trec` directory holds
// =============================================================================

/**
 * Serialize a {@link Recording} into the set of files a `.trec` directory
 * holds: a `name → bytes` map. This is the shared core of {@link writeRecording}
 * (writes the map to a directory) and {@link packRecording} (zips the map).
 *
 * `pngSourceDir` resolves each frame's `png` filename to bytes; a missing PNG
 * is skipped (the index still records the frame) — mirroring the frame
 * tracer's render-failure tolerance.
 */
function serializeRecording(recording: Recording, pngSourceDir?: string): Map<string, Uint8Array> {
  const encoder = new TextEncoder()
  const files = new Map<string, Uint8Array>()

  const traceFrames = recording.frames !== undefined ? recordingFramesToTraceFrames(recording) : []
  const fingerprint = recording.frames?.[0]?.fingerprint

  const manifest: TrecManifest = {
    trecVersion: TREC_FORMAT_VERSION,
    recordingVersion: recording.version,
    cols: recording.cols,
    rows: recording.rows,
    durationMicros: recording.durationMicros,
    reproducible: recording.provenance.reproducible,
    tracks: {
      commands: recording.commands !== undefined,
      io: recording.io !== undefined,
      frames: recording.frames !== undefined,
    },
    ...(fingerprint !== undefined ? { fingerprint } : {}),
  }
  files.set(MANIFEST_FILE, encoder.encode(JSON.stringify(manifest, null, 2) + "\n"))

  if (recording.commands !== undefined) {
    files.set(COMMANDS_FILE, encoder.encode(toJsonl(recording.commands)))
  }
  if (recording.io !== undefined) {
    files.set(IO_FILE, encoder.encode(toJsonl(recording.io)))
  }
  if (recording.frames !== undefined) {
    files.set(`${FRAMES_DIR}/${FRAMES_INDEX}`, encoder.encode(toJsonl(traceFrames)))
    if (pngSourceDir !== undefined) {
      for (const frame of traceFrames) {
        if (frame.png === null) continue
        const src = join(pngSourceDir, frame.png)
        if (!existsSync(src)) continue
        files.set(`${FRAMES_DIR}/${frame.png}`, new Uint8Array(readFileSync(src)))
      }
    }
  }

  return files
}

/**
 * Reconstruct a {@link Recording} from a `.trec` `name → bytes` file map.
 *
 * The manifest is authoritative for `cols` / `rows` / `durationMicros` /
 * `provenance`. The frames projection is rebuilt by projecting the
 * `frames/index.jsonl` `TraceFrame` rows through {@link traceToRecording} — the
 * shared adapter — so a `.trec` and a bare frame-trace directory take the same
 * projection path. PNG bytes are NOT loaded into the Recording; each frame's
 * `png` field stays a relative filename.
 */
function deserializeRecording(files: Map<string, Uint8Array>, backend: string): Recording {
  const decoder = new TextDecoder()
  const manifestRaw = files.get(MANIFEST_FILE)
  if (manifestRaw === undefined) {
    throw new Error("readRecording: .trec directory has no manifest.json")
  }
  const manifest = JSON.parse(decoder.decode(manifestRaw)) as TrecManifest

  const commandsRaw = files.get(COMMANDS_FILE)
  const ioRaw = files.get(IO_FILE)
  const framesRaw = files.get(`${FRAMES_DIR}/${FRAMES_INDEX}`)

  const commands = commandsRaw !== undefined ? parseJsonl<Command>(decoder.decode(commandsRaw)) : undefined
  const io = ioRaw !== undefined ? parseJsonl<IoEvent>(decoder.decode(ioRaw)) : undefined

  // The frames projection: project the on-disk TraceFrame rows through the
  // shared adapter, then adopt that projection's frames.
  let frames: Recording["frames"]
  if (framesRaw !== undefined) {
    const traceFrames = parseJsonl<TraceFrame>(decoder.decode(framesRaw))
    if (traceFrames.length > 0) {
      const projected = traceToRecording({
        frames: traceFrames,
        cols: manifest.cols,
        rows: manifest.rows,
        backend: manifest.fingerprint?.backend ?? backend,
        reproducible: manifest.reproducible,
      })
      frames = projected.frames
    }
  }

  return createRecording({
    cols: manifest.cols,
    rows: manifest.rows,
    durationMicros: micros(manifest.durationMicros),
    ...(commands !== undefined ? { commands } : {}),
    ...(io !== undefined ? { io } : {}),
    ...(frames !== undefined ? { frames } : {}),
    provenance: { reproducible: manifest.reproducible },
  })
}

// =============================================================================
// Directory I/O — writeRecording / readRecording
// =============================================================================

/**
 * Write a {@link Recording} to a `.trec` directory at `dir`.
 *
 * The destination directory is **wiped and recreated** — `writeRecording`
 * produces a clean bundle, never merges into an existing one. It writes
 * `manifest.json`, the present source tracks (`commands.jsonl` / `io.jsonl`),
 * and the frames projection (`frames/index.jsonl` + the unique-frame PNGs
 * copied from {@link WriteRecordingOptions.pngSourceDir}).
 *
 * The `frames/` sub-tree is byte-compatible with the legacy frame-trace
 * directory layout.
 *
 * @param dir Destination `.trec` directory. Created if missing; prior contents
 *   are removed.
 * @param recording The recording to serialize.
 * @param options See {@link WriteRecordingOptions}.
 */
export function writeRecording(dir: string, recording: Recording, options: WriteRecordingOptions = {}): void {
  const files = serializeRecording(recording, options.pngSourceDir)
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
  mkdirSync(dir, { recursive: true })
  for (const [name, bytes] of files) {
    const dest = join(dir, name)
    mkdirSync(join(dest, ".."), { recursive: true })
    writeFileSync(dest, bytes)
  }
}

/**
 * Read a `.trec` directory at `dir` into a {@link Recording}.
 *
 * Accepts **both** forms:
 *
 *  - A full `.trec` directory — has a `manifest.json`; all present tracks are
 *    loaded.
 *  - A **bare legacy frame-trace directory** — no `manifest.json`, just
 *    `index.jsonl` + `NNNNN.png` (the layout km goldens use). It is loaded as
 *    a frames-only Recording. This is the superset-compatibility guarantee:
 *    every existing km golden trace loads through `readRecording` unchanged.
 *
 * PNG bytes are NOT loaded into the Recording; each frame's `png` field stays a
 * relative filename, resolved by a consumer against the directory.
 *
 * @param dir Path to a `.trec` directory, or a bare frame-trace directory.
 * @param options See {@link ReadRecordingOptions}.
 * @returns The reconstructed {@link Recording}.
 * @throws {Error} when `dir` is neither a `.trec` directory nor a frame-trace
 *   directory (no `manifest.json` and no `index.jsonl`).
 */
export function readRecording(dir: string, options: ReadRecordingOptions = {}): Recording {
  const backend = options.backend ?? "unknown"
  const manifestPath = join(dir, MANIFEST_FILE)

  // Bare legacy frame-trace directory — no manifest, frames-only.
  if (!existsSync(manifestPath)) {
    const legacyIndex = join(dir, FRAMES_INDEX)
    if (!existsSync(legacyIndex)) {
      throw new Error(
        `readRecording: ${dir} is not a .trec directory (no manifest.json) ` +
          `and not a frame-trace directory (no index.jsonl)`,
      )
    }
    const traceFrames = parseJsonl<TraceFrame>(readFileSync(legacyIndex, "utf-8"))
    if (traceFrames.length === 0) {
      throw new Error(`readRecording: ${legacyIndex} contains no parseable frames`)
    }
    const first = traceFrames[0]!
    return traceToRecording({
      frames: traceFrames,
      cols: first.buffer.cols,
      rows: first.buffer.rows,
      backend,
    })
  }

  // Full .trec directory — collect the known files into a bundle map.
  const files = new Map<string, Uint8Array>()
  files.set(MANIFEST_FILE, new Uint8Array(readFileSync(manifestPath)))
  for (const name of [COMMANDS_FILE, IO_FILE]) {
    const path = join(dir, name)
    if (existsSync(path)) files.set(name, new Uint8Array(readFileSync(path)))
  }
  const framesDir = join(dir, FRAMES_DIR)
  if (existsSync(framesDir) && statSync(framesDir).isDirectory()) {
    for (const name of readdirSync(framesDir)) {
      files.set(`${FRAMES_DIR}/${name}`, new Uint8Array(readFileSync(join(framesDir, name))))
    }
  }
  return deserializeRecording(files, backend)
}

// =============================================================================
// Archive I/O — packRecording / unpackRecording
// =============================================================================

/**
 * Pack a `.trec` directory into a portable single-file `.trec` archive.
 *
 * The archive is a standard ZIP (like `.docx` / `.epub`) — every file in the
 * `.trec` directory becomes an archive entry, paths relative to the directory
 * root. The archive path is **optional**: the directory bundle is the default
 * working form; `pack` produces the convenient single-file form for transport.
 *
 * @param dir Source `.trec` directory.
 * @param archivePath Destination archive file (conventionally ending `.trec`).
 * @throws {Error} when `dir` does not exist.
 */
export function packRecording(dir: string, archivePath: string): void {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`packRecording: ${dir} is not a directory`)
  }
  const entries: ZipEntry[] = []
  for (const path of walk(dir)) {
    entries.push({ path: relativeSlash(dir, path), bytes: new Uint8Array(readFileSync(path)) })
  }
  // Stable order — sorted paths produce a reproducible archive.
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  writeFileSync(archivePath, buildZip(entries))
}

/**
 * Unpack a single-file `.trec` archive back into a `.trec` directory.
 *
 * The inverse of {@link packRecording}. The destination directory is wiped and
 * recreated, then every archive entry is written to its path within it.
 *
 * @param archivePath Source `.trec` archive file.
 * @param dir Destination `.trec` directory. Created if missing; prior contents
 *   are removed.
 * @throws {Error} when `archivePath` does not exist.
 */
export function unpackRecording(archivePath: string, dir: string): void {
  if (!existsSync(archivePath)) {
    throw new Error(`unpackRecording: ${archivePath} does not exist`)
  }
  const entries = parseZip(new Uint8Array(readFileSync(archivePath)))
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
  mkdirSync(dir, { recursive: true })
  for (const entry of entries) {
    const dest = join(dir, entry.path)
    mkdirSync(join(dest, ".."), { recursive: true })
    writeFileSync(dest, entry.bytes)
  }
}

/** Recursively list every file path under `root` (directories excluded). */
function walk(root: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(root)) {
    const path = join(root, name)
    if (statSync(path).isDirectory()) {
      out.push(...walk(path))
    } else {
      out.push(path)
    }
  }
  return out
}

/** Path of `file` relative to `root`, forward-slash separated (ZIP convention). */
function relativeSlash(root: string, file: string): string {
  const rel = file.slice(root.length).replace(/^[/\\]+/, "")
  return rel.split(/[/\\]/).join("/")
}

/**
 * Probe whether a path uses the `.trec` extension — the conventional name for
 * both a `.trec` directory bundle and a packed `.trec` archive file.
 */
export function isTrecPath(path: string): boolean {
  return basename(path).endsWith(".trec")
}
