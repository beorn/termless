/**
 * `.tty` / `.ttyz` — the unified recording format: **one format, two
 * encodings, one encoding-blind reader.** Normative reference:
 * `docs/reference/formats/tty.md`.
 *
 *  - **`.tty`** — the recording *bundle*: a plain directory holding
 *    `manifest.json` plus the recording's members as ordinary files. The live
 *    encoding (a session under capture appends to the bundle's one open tail)
 *    and the source-of-truth encoding at rest. Uncompressed, full stop.
 *  - **`.ttyz`** — the *sealed* encoding: the same members packed into one
 *    ZIP container (ZIP64-capable, per-member compression method). Sealing is
 *    a manifest state transition — the open tail rotates into the sealed
 *    member list — then a pack; live and sealed are two manifest states over
 *    one member store.
 *
 * {@link readRecording} accepts a live bundle directory or a sealed archive —
 * nothing else — and produces an identical {@link Recording} from either. No
 * downstream consumer can tell which encoding it was handed; encoding exists
 * as a concept only here and in {@link packRecording}/{@link unpackRecording}.
 *
 * Members are **typed and declaratively pathed**: the manifest names each
 * member's path, type, and encoding, and the reader dispatches on the
 * manifest, never on file-name conventions. That is what lets a legacy
 * frame-trace directory become a valid bundle by *adding one manifest* (its
 * `index.jsonl` + PNGs byte-identical), and what lets an always-on session
 * writer's binary journal segments join the same format as first-class io
 * members (`hts1` encoding) without a bridge.
 *
 * This module supersedes the retired `.rec` container — deleted, not aliased:
 * no `.rec` artifact was ever shipped, so there was nothing to migrate.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import type { TraceFrame } from "../frame-trace.ts"
import { recordingToTraceFrames, traceToRecording } from "../frame-trace-recording.ts"
import {
  type Command,
  type IoEvent,
  type Micros,
  type Recording,
  type RendererFingerprint,
  createRecording,
  micros,
  millisToMicros,
} from "../recording.ts"
import { buildZip, parseZip, type ZipEntry } from "./zip-archive.ts"
import { eventFromIoEvent } from "../io-compat.ts"
import type { Event } from "../../io/event.ts"
import type { Recording as IoRecording, RecordingHeader as IoRecordingHeader } from "../../io/recording.ts"

/** The `.tty` format version written into every `manifest.json`. */
export const TTY_FORMAT_VERSION = 1

const MANIFEST_FILE = "manifest.json"

// =============================================================================
// The manifest — typed, declaratively pathed members
// =============================================================================

/** What a member carries — the dispatch key for the reader. */
export type TtyMemberType = "io" | "commands" | "frames" | "facts" | "checkpoint" | "habcp"

/**
 * How a member's bytes are encoded. `zstd-seekable` is RESERVED for large
 * sealed io members: declared in the format, not yet implemented — a reader
 * encountering it fails loud rather than skipping (a skipped member would be
 * a silently shorter recording).
 */
export type TtyMemberEncoding = "jsonl" | "hts1" | "trace-index" | "json" | "zstd-seekable"

/** One sealed member of a bundle. */
export interface TtyMember {
  /** Path within the bundle, forward-slash separated. Declarative — the reader looks HERE, never at naming conventions. */
  path: string
  /** What the member carries. */
  type: TtyMemberType
  /** How its bytes are encoded. */
  encoding: TtyMemberEncoding
  /** Advisory time range covered, integer µs on the recording clock. The member bytes are authoritative. */
  micros?: [number, number]
}

/** The one open segment of a LIVE bundle. Absent in a sealed bundle. */
export interface TtyTail {
  path: string
  type: TtyMemberType
  encoding: TtyMemberEncoding
}

/**
 * `manifest.json` — the member index of a `.tty`/`.ttyz` recording.
 *
 * Written atomically, rewritten only on member rotation or seal. A manifest
 * with a `tail` is a live bundle; without one it is at rest.
 */
export interface TtyManifest {
  /** {@link TTY_FORMAT_VERSION}. */
  ttyVersion: number
  /** Recording-model version (currently always `1`). */
  recordingVersion: 1
  /** Terminal columns at recording start; `0` = take geometry from a frames member's rows. */
  cols: number
  /** Terminal rows at recording start; `0` = take geometry from a frames member's rows. */
  rows: number
  /** Total duration, integer µs. */
  durationMicros: number
  /** Whether the frames projection is regenerable from io. */
  reproducible: boolean
  /**
   * Wall-clock ms of µs-origin 0. Required when any member's encoding stamps
   * wall-clock time (`hts1`); those stamps rebase against this origin. When
   * absent, the first event of the earliest wall-clock member defines µs 0.
   */
  originWallMs?: number
  /** The renderer fingerprint of a frames-bearing recording. */
  fingerprint?: RendererFingerprint
  /** The sealed members. Every listed member is complete and immutable. */
  members: TtyMember[]
  /** The ONE open segment of a live bundle. */
  tail?: TtyTail
}

/** The skip tally of a read: journal events that map to no Recording track. Tallied, never silent. */
export interface TtySkipTally {
  lifecycle: number
  truncation: number
}

/** The manifest-aware read result — {@link readBundle}. */
export interface ReadBundleResult {
  recording: Recording
  manifest: TtyManifest
  skipped: TtySkipTally
}

/** Options for {@link readBundle}. */
export interface ReadBundleOptions {
  /**
   * Backend id stamped onto synthesized renderer fingerprints when the
   * manifest carries none. The manifest's own fingerprint always wins; this
   * only replaces the `"unknown"` fallback. Domain doors (`loadVisualTrace`)
   * use it — the encoding-blind {@link readRecording} takes no options.
   */
  backendFallback?: string
}

/** Options for {@link writeRecording}. */
export interface WriteRecordingOptions {
  /**
   * Directory the frames projection's PNGs are copied *from*. Each frame's
   * `png` field is a relative filename resolved against this directory. Omit
   * when the recording carries no rasters on disk.
   */
  pngSourceDir?: string
}

// =============================================================================
// JSONL helpers
// =============================================================================

function toJsonl(records: readonly unknown[]): string {
  if (records.length === 0) return ""
  return records.map((r) => JSON.stringify(r)).join("\n") + "\n"
}

/** Tolerant JSONL parse: blank lines and a truncated final line are skipped (append-tear tolerance). */
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
// hts1 — the binary journal framing, decoded natively
// =============================================================================
//
// The framing of the always-on session writer's `journal.hts`:
// "HTS1" magic, one version byte, big-endian u32 header/payload lengths, a
// JSON header, raw payload bytes. A truncated trailing frame is a TEAR (clean
// stop); bad magic or version is CORRUPTION (throw). These two error paths
// never collapse into one.

const HTS_MAGIC = [0x48, 0x54, 0x53, 0x31] // "HTS1"
const HTS_VERSION = 1
const HTS_PREFIX = 4 + 1 + 8
const HTS_MAX_HEADER = 64 * 1024
const HTS_MAX_PAYLOAD = 16 * 1024 * 1024

interface HtsHeader {
  kind: "output" | "input" | "resize" | "lifecycle" | "truncation"
  offset: number
  /** Wall-clock milliseconds. */
  at: number
  size?: { cols: number; rows: number }
  state?: string
  retainedFromOffset?: number
}

interface HtsFrame {
  header: HtsHeader
  payload: Uint8Array
}

function readU32BE(bytes: Uint8Array, at: number): number {
  return (
    (((bytes[at] ?? 0) << 24) | ((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0)) >>> 0
  )
}

/** Decode an hts1 byte stream. Tear-tolerant; corruption throws. */
function decodeHtsFrames(bytes: Uint8Array, memberPath: string): HtsFrame[] {
  const frames: HtsFrame[] = []
  let at = 0
  while (bytes.length - at >= HTS_PREFIX) {
    for (let i = 0; i < HTS_MAGIC.length; i++) {
      if (bytes[at + i] !== HTS_MAGIC[i]) {
        throw new Error(`readRecording: bad hts1 frame magic in member "${memberPath}" at byte ${String(at)}`)
      }
    }
    if (bytes[at + 4] !== HTS_VERSION) {
      throw new Error(`readRecording: unsupported hts1 frame version in member "${memberPath}" at byte ${String(at)}`)
    }
    const headerLen = readU32BE(bytes, at + 5)
    const payloadLen = readU32BE(bytes, at + 9)
    if (headerLen > HTS_MAX_HEADER) {
      throw new Error(`readRecording: hts1 header too large in member "${memberPath}" at byte ${String(at)}`)
    }
    if (payloadLen > HTS_MAX_PAYLOAD) {
      throw new Error(`readRecording: hts1 payload too large in member "${memberPath}" at byte ${String(at)}`)
    }
    const total = HTS_PREFIX + headerLen + payloadLen
    if (bytes.length - at < total) break // torn tail — clean stop at the last complete frame
    const header = JSON.parse(
      new TextDecoder().decode(bytes.subarray(at + HTS_PREFIX, at + HTS_PREFIX + headerLen)),
    ) as HtsHeader
    frames.push({ header, payload: bytes.slice(at + HTS_PREFIX + headerLen, at + total) })
    at += total
  }
  return frames
}

// =============================================================================
// Member loading — dispatch by type + encoding, off the manifest
// =============================================================================

/** A loaded bundle: every member's bytes reachable by path, whatever the encoding held them. */
interface BundleSource {
  bytesOf(path: string): Uint8Array
  has(path: string): boolean
}

interface LoadedTracks {
  io: IoEvent[]
  commands: Command[]
  frames: Recording["frames"]
  framesReproducible: boolean | undefined
  /** The frames projection's own duration — authoritative when the manifest declares 0 (frames-only traces). */
  framesDurationMicros: Micros | undefined
  skipped: TtySkipTally
}

const utf8 = new TextDecoder()

function loadMembers(manifest: TtyManifest, source: BundleSource, backendFallback?: string): LoadedTracks {
  const io: IoEvent[] = []
  const commands: Command[] = []
  let frames: Recording["frames"]
  let framesReproducible: boolean | undefined
  let framesDurationMicros: Micros | undefined
  const skipped: TtySkipTally = { lifecycle: 0, truncation: 0 }

  const loadable: Array<TtyMember | TtyTail> = [
    ...manifest.members,
    ...(manifest.tail !== undefined ? [manifest.tail] : []),
  ]

  // The µs origin for wall-clock members: the manifest's anchor, else the
  // first event of the earliest hts1 member (resolved lazily below).
  let originWallMs = manifest.originWallMs

  for (const member of loadable) {
    if (!source.has(member.path)) {
      throw new Error(`readRecording: manifest names member "${member.path}" but the bundle has no such file`)
    }
    switch (member.encoding) {
      case "jsonl": {
        const rows = utf8.decode(source.bytesOf(member.path))
        if (member.type === "io") {
          io.push(...parseJsonl<IoEvent>(rows))
        } else if (member.type === "commands") {
          commands.push(...parseJsonl<Command>(rows))
        } else if (member.type === "facts" || member.type === "habcp") {
          // Facts are the annotation source, not a Recording track — the
          // member is surfaced through the manifest, deliberately not loaded.
          // A habcp member (the habitat's control-plane journal: tail +
          // sealed segments) is equally opaque here BY RULING: this reader
          // knows the kind string and that the content is NDJSON rows, never
          // the row schema — hab-side readers own those semantics.
        } else {
          throw new Error(
            `readRecording: member "${member.path}" declares type "${member.type}" with jsonl encoding — no such track`,
          )
        }
        break
      }
      case "hts1": {
        if (member.type !== "io") {
          throw new Error(
            `readRecording: hts1 encoding is an io framing; member "${member.path}" declares "${member.type}"`,
          )
        }
        const frames1 = decodeHtsFrames(source.bytesOf(member.path), member.path)
        if (originWallMs === undefined && frames1.length > 0) originWallMs = frames1[0]!.header.at
        for (const f of frames1) {
          const at = rebase(f.header.at, originWallMs!, f.header.offset, member.path)
          switch (f.header.kind) {
            case "output":
              io.push({ at, direction: "out", data: utf8.decode(f.payload) })
              break
            case "input":
              // The io track is direction-tagged bytes, not peer-attributed —
              // `owner` survives only in the source member.
              io.push({ at, direction: "in", data: utf8.decode(f.payload) })
              break
            case "resize": {
              const size = f.header.size
              if (size === undefined) {
                throw new Error(`readRecording: hts1 resize frame missing size in member "${member.path}"`)
              }
              commands.push({ kind: "resize", at, cols: size.cols, rows: size.rows })
              break
            }
            case "lifecycle":
              skipped.lifecycle += 1
              break
            case "truncation":
              skipped.truncation += 1
              break
          }
        }
        break
      }
      case "trace-index": {
        if (member.type !== "frames") {
          throw new Error(
            `readRecording: trace-index encoding is a frames index; member "${member.path}" declares "${member.type}"`,
          )
        }
        const rawIndex = utf8.decode(source.bytesOf(member.path))
        const traceFrames = parseJsonl<TraceFrame>(rawIndex)
        if (traceFrames.length === 0 && rawIndex.trim().length > 0) {
          // Non-empty bytes, zero parseable rows: corrupt content, not an
          // empty trace — refuse rather than project a silently empty member.
          throw new Error(`readRecording: frames member "${member.path}" contains no parseable frames`)
        }
        if (traceFrames.length > 0) {
          const first = traceFrames[0]!
          const cols = manifest.cols > 0 ? manifest.cols : first.buffer.cols
          const rows = manifest.rows > 0 ? manifest.rows : first.buffer.rows
          const projected = traceToRecording({
            frames: traceFrames,
            cols,
            rows,
            backend: manifest.fingerprint?.backend ?? backendFallback ?? "unknown",
            reproducible: manifest.reproducible,
          })
          frames = projected.frames
          framesReproducible = projected.provenance.reproducible
          framesDurationMicros = projected.durationMicros
        }
        break
      }
      case "json": {
        if (member.type !== "checkpoint") {
          throw new Error(
            `readRecording: json encoding carries checkpoints; member "${member.path}" declares "${member.type}"`,
          )
        }
        // Checkpoints are derived seek keyframes — streams are stored,
        // snapshots are derived. Surfaced through the manifest, not loaded
        // into the Recording.
        break
      }
      case "zstd-seekable":
        throw new Error(
          `readRecording: member "${member.path}" declares the reserved zstd-seekable encoding, which is not yet implemented — refusing to skip it`,
        )
      default:
        throw new Error(
          `readRecording: member "${member.path}" declares unknown encoding "${String((member as TtyMember).encoding)}"`,
        )
    }
  }

  io.sort((a, b) => a.at - b.at)
  commands.sort((a, b) => a.at - b.at)
  return { io, commands, frames, framesReproducible, framesDurationMicros, skipped }
}

/** Rebase a wall-clock ms stamp onto the µs clock. A stamp before the origin is corruption, never clamped. */
function rebase(wallMs: number, originWallMs: number, offset: number, memberPath: string): Micros {
  const deltaMs = wallMs - originWallMs
  if (deltaMs < 0) {
    throw new Error(
      `readRecording: event at offset ${String(offset)} in member "${memberPath}" has wall-clock ms ${String(wallMs)} ` +
        `before the recording's origin (${String(originWallMs)}); the µs timebase must be monotonic`,
    )
  }
  return millisToMicros(deltaMs)
}

function recordingOf(manifest: TtyManifest, tracks: LoadedTracks): Recording {
  return createRecording({
    cols: manifest.cols > 0 ? manifest.cols : (tracks.frames?.[0]?.buffer.cols ?? 0),
    rows: manifest.rows > 0 ? manifest.rows : (tracks.frames?.[0]?.buffer.rows ?? 0),
    durationMicros:
      manifest.durationMicros > 0 ? micros(manifest.durationMicros) : (tracks.framesDurationMicros ?? micros(0)),
    ...(tracks.commands.length > 0 ? { commands: tracks.commands } : {}),
    ...(tracks.io.length > 0 ? { io: tracks.io } : {}),
    ...(tracks.frames !== undefined ? { frames: tracks.frames } : {}),
    provenance: { reproducible: tracks.framesReproducible ?? manifest.reproducible },
  })
}

// =============================================================================
// Reading — one encoding-blind door + the manifest-aware door
// =============================================================================

function parseManifest(raw: Uint8Array, where: string): TtyManifest {
  const manifest = JSON.parse(utf8.decode(raw)) as TtyManifest
  if (manifest.ttyVersion !== TTY_FORMAT_VERSION) {
    throw new Error(
      `readRecording: ${where} declares ttyVersion ${String(manifest.ttyVersion)}; this reader speaks ${String(TTY_FORMAT_VERSION)}`,
    )
  }
  return manifest
}

function dirSource(dir: string): BundleSource {
  return {
    bytesOf: (path: string) => new Uint8Array(readFileSync(join(dir, path))),
    has: (path: string) => existsSync(join(dir, path)),
  }
}

function zipSource(entries: ZipEntry[]): BundleSource {
  const byPath = new Map<string, Uint8Array>()
  for (const e of entries) byPath.set(e.path, e.bytes)
  return {
    bytesOf: (path: string) => {
      const bytes = byPath.get(path)
      if (bytes === undefined) throw new Error(`readRecording: sealed archive has no member "${path}"`)
      return bytes
    },
    has: (path: string) => byPath.has(path),
  }
}

/**
 * Open a `.tty` bundle directory or `.ttyz` sealed archive and parse its
 * manifest — shared by every reading door (`readBundle` and `loadBundle`
 * alike). `doorName` names the calling door in error messages (`readRecording`
 * for the Trace-shaped doors, `loadRecording` for the io-shaped ones) so each
 * door's errors read as its own, even though the dispatch is one
 * implementation.
 */
function bundleSourceOf(path: string, doorName: string): { manifest: TtyManifest; source: BundleSource } {
  if (!existsSync(path)) {
    throw new Error(`${doorName}: ${path} does not exist`)
  }
  if (statSync(path).isFile()) {
    const entries = parseZip(new Uint8Array(readFileSync(path)))
    const source = zipSource(entries)
    if (!source.has(MANIFEST_FILE)) {
      throw new Error(`${doorName}: ${path} is not a .ttyz recording (no manifest.json entry)`)
    }
    return { manifest: parseManifest(source.bytesOf(MANIFEST_FILE), path), source }
  }
  const manifestPath = join(path, MANIFEST_FILE)
  if (!existsSync(manifestPath)) {
    throw new Error(
      `${doorName}: ${path} is not a .tty bundle — it has no manifest.json. ` +
        `A legacy frame-trace directory becomes a valid bundle by adding a manifest that declares its index.jsonl as a frames member.`,
    )
  }
  const source = dirSource(path)
  return { manifest: parseManifest(source.bytesOf(MANIFEST_FILE), manifestPath), source }
}

/**
 * Read a `.tty`/`.ttyz` recording with its manifest and skip tally — the
 * manifest-aware door for annotation, windowed, and player consumers.
 * Accepts both encodings; identical Recording from either.
 *
 * @deprecated The Trace-shaped door — {@link loadBundle} is the io-shaped
 * equivalent. Unchanged until unterm phase A4a, when the root barrel's
 * `Recording` flips to the io shape and this door is removed.
 */
export function readBundle(path: string, options: ReadBundleOptions = {}): ReadBundleResult {
  const { manifest, source } = bundleSourceOf(path, "readRecording")
  const tracks = loadMembers(manifest, source, options.backendFallback)
  return { recording: recordingOf(manifest, tracks), manifest, skipped: tracks.skipped }
}

/**
 * Read a recording — **the encoding-blind door**. Accepts a live `.tty`
 * bundle directory or a sealed `.ttyz` archive, nothing else, and produces an
 * identical {@link Recording} from either. Nothing about the result names the
 * encoding it came from.
 *
 * @deprecated The Trace-shaped door — {@link loadRecording} is the io-shaped
 * equivalent. Unchanged until unterm phase A4a, when the root barrel's
 * `Recording` flips to the io shape and this door is removed.
 */
export function readRecording(path: string): Recording {
  return readBundle(path).recording
}

// =============================================================================
// The io-shaped door — loadBundle / loadRecording (unterm phase A3, slice 5)
// =============================================================================
//
// readBundle/readRecording above return the Trace-shaped Recording
// (`../recording.ts`, `@deprecated` alias of `Trace`): commands + io + frames
// tracks, `IoEvent` rows decoded to strings. loadBundle/loadRecording below
// return the io-shaped Recording (`Event[]`, raw bytes, `@termless/core/io`)
// per the unterm A3 D5 ruling: a new name now; `readRecording` itself flips
// to this shape at phase A4a, when the Trace alias is deleted.
//
// Member → Event mapping (normative doc: docs/reference/formats/tty.md,
// "Loading as an io Recording"):
//  - io member, hts1 encoding: output/input frames become Events carrying
//    the RAW payload bytes as `data` (no UTF-8 round trip — the Trace door's
//    decode is the lossy step this door removes); a resize frame becomes a
//    CAPTURED `control`/`resize` event — no `derived` flag, since it is
//    exactly what the source recorded, the same frame the Trace door reads
//    into its `commands` track, just typed as this vocabulary's `control`
//    member instead. `at` rebased from wall-ms exactly as `rebase()` does
//    for the Trace door, same corruption error. lifecycle/truncation frames
//    have no Event form (same as the Trace door, which also only tallies
//    them) — tallied here too, never silently dropped.
//  - io member, jsonl encoding: each row through `eventFromIoEvent`.
//  - commands / frames / facts / habcp / checkpoint members: not loaded —
//    tallied by path, the same treatment `readBundle` gives them today.
//    Checkpoint-derived marks and reconstructed resize deltas are NOT part
//    of this slice: the only real producer of a checkpoint member is the hab
//    side (`TerminalCheckpoint { reason, at, throughOffset, snapshot }`,
//    `snapshot` a vterm.js-owned shape), and this format's own doc leaves a
//    checkpoint's content unspecified — a reader for an invented shape would
//    be fiction. That reader is a later slice, against the real producer.

/** Member paths {@link loadBundle} did not load into the io Recording, plus hts1 frame kinds with no Event form — tallied, never a silent drop. */
export interface TtyLoadSkipped {
  /** `commands` member paths — the io Event union has no commands track. */
  commands: string[]
  /** `frames` member paths — frames are a Trace-only projection. */
  frames: string[]
  /** `facts` member paths — the annotation source, never a Recording track. */
  facts: string[]
  /** `habcp` member paths — opaque by ruling; hab-side readers own the row schema. */
  habcp: string[]
  /** `checkpoint` member paths — this door doesn't read a checkpoint's content yet (see the section docstring above); a later slice turns these into derived marks/resizes against the real producer's shape. */
  checkpoint: string[]
  /** hts1 frames of kind `lifecycle` in a loaded io member — no Event form, same as the Trace door. */
  lifecycle: number
  /** hts1 frames of kind `truncation` in a loaded io member — no Event form, same as the Trace door. */
  truncation: number
}

/** The manifest-aware io-shaped read result — {@link loadBundle}. */
export interface LoadBundleResult {
  recording: IoRecording
  manifest: TtyManifest
  skipped: TtyLoadSkipped
}

function emptySkipped(): TtyLoadSkipped {
  return { commands: [], frames: [], facts: [], habcp: [], checkpoint: [], lifecycle: 0, truncation: 0 }
}

/** Every member of a bundle, sealed members plus a live tail if present — the same set {@link loadMembers} iterates. */
function everyMember(manifest: TtyManifest): Array<TtyMember | TtyTail> {
  return [...manifest.members, ...(manifest.tail !== undefined ? [manifest.tail] : [])]
}

function describeMembers(members: Array<TtyMember | TtyTail>): string {
  return members.map((m) => `${m.path} (${m.type})`).join(", ") || "no members"
}

interface LoadedIoEvents {
  events: Event[]
  skipped: TtyLoadSkipped
  sawHts1: boolean
  originWallMs: number | undefined
}

/** Load every member into the io Event union — the loop {@link loadMembers} runs for the Trace shape, adapted for `Event[]` output. */
function loadIoEvents(manifest: TtyManifest, source: BundleSource): LoadedIoEvents {
  const events: Event[] = []
  const skipped = emptySkipped()
  let originWallMs = manifest.originWallMs
  let sawHts1 = false

  for (const member of everyMember(manifest)) {
    if (!source.has(member.path)) {
      throw new Error(`loadRecording: manifest names member "${member.path}" but the bundle has no such file`)
    }
    if (
      member.type === "commands" ||
      member.type === "frames" ||
      member.type === "facts" ||
      member.type === "habcp" ||
      member.type === "checkpoint"
    ) {
      skipped[member.type].push(member.path)
      continue
    }
    // member.type is "io" from here — every other type is skipped above.
    switch (member.encoding) {
      case "jsonl": {
        const rows = utf8.decode(source.bytesOf(member.path))
        for (const row of parseJsonl<IoEvent>(rows)) {
          events.push(eventFromIoEvent(row))
        }
        break
      }
      case "hts1": {
        const frames1 = decodeHtsFrames(source.bytesOf(member.path), member.path)
        if (originWallMs === undefined && frames1.length > 0) originWallMs = frames1[0]!.header.at
        for (const f of frames1) {
          switch (f.header.kind) {
            case "output":
              events.push({
                at: rebase(f.header.at, originWallMs!, f.header.offset, member.path),
                type: "output",
                data: f.payload,
              })
              break
            case "input":
              events.push({
                at: rebase(f.header.at, originWallMs!, f.header.offset, member.path),
                type: "input",
                data: f.payload,
              })
              break
            case "resize": {
              const size = f.header.size
              if (size === undefined) {
                throw new Error(`loadRecording: hts1 resize frame missing size in member "${member.path}"`)
              }
              // A captured resize — the source recorded it, so unlike a
              // checkpoint-reconstructed delta this carries no `derived`.
              events.push({
                at: rebase(f.header.at, originWallMs!, f.header.offset, member.path),
                type: "control",
                control: "resize",
                size: { cols: size.cols, rows: size.rows },
              })
              break
            }
            case "lifecycle":
              skipped.lifecycle += 1
              break
            case "truncation":
              skipped.truncation += 1
              break
          }
        }
        sawHts1 = true
        break
      }
      case "zstd-seekable":
        throw new Error(
          `loadRecording: member "${member.path}" declares the reserved zstd-seekable encoding, which is not yet implemented — refusing to skip it`,
        )
      case "trace-index":
      case "json":
        throw new Error(
          `loadRecording: member "${member.path}" declares type "io" with "${member.encoding}" encoding — no such io encoding`,
        )
      default:
        throw new Error(
          `loadRecording: member "${member.path}" declares unknown encoding "${String((member as TtyMember).encoding)}"`,
        )
    }
  }

  events.sort((a, b) => a.at - b.at)
  return { events, skipped, sawHts1, originWallMs }
}

/**
 * Read a `.tty`/`.ttyz` recording as the io-shaped {@link IoRecording} — the
 * manifest-aware door. See the section docstring above for the member →
 * Event mapping. Unlike {@link readBundle} it takes no options: the only
 * option that door has (`backendFallback`) stamps synthesized frame
 * fingerprints, and this door never loads frames — an accepted-but-inert
 * option would be a silent no-op.
 *
 * @throws {Error} when the bundle yields no events at all (e.g. a
 * frames-only, commands-only, or checkpoints-only bundle) — naming the
 * members it has, since the io shape has nothing else to say about it.
 */
export function loadBundle(path: string): LoadBundleResult {
  const { manifest, source } = bundleSourceOf(path, "loadRecording")
  const { events, skipped, sawHts1, originWallMs } = loadIoEvents(manifest, source)

  if (events.length === 0) {
    throw new Error(
      `loadRecording: ${path} produced no events for the io Recording — it has only: ${describeMembers(everyMember(manifest))}`,
    )
  }

  // sourceResolution is decided by the io members alone: "ms" when any
  // loaded io member is hts1, "us" otherwise. Every event above came from an
  // io member (hts1 or jsonl — checkpoints are tallied, not loaded), so a
  // non-empty `events` guarantees one of the two was loaded.
  const sourceResolution: "us" | "ms" = sawHts1 ? "ms" : "us"

  const header: IoRecordingHeader = {
    version: 1,
    size: { cols: manifest.cols > 0 ? manifest.cols : 0, rows: manifest.rows > 0 ? manifest.rows : 0 },
    duration: manifest.durationMicros > 0 ? micros(manifest.durationMicros) : events[events.length - 1]!.at,
    sourceResolution,
    ...(originWallMs !== undefined ? { timestamp: originWallMs } : {}),
  }
  return { recording: { header, events }, manifest, skipped }
}

/**
 * Read a recording as the io-shaped {@link IoRecording} — the encoding-blind
 * door. Accepts a live `.tty` bundle directory or a sealed `.ttyz` archive,
 * nothing else — the io-shaped counterpart of {@link readRecording}: same
 * input contract, `Event[]` output.
 */
export function loadRecording(path: string): IoRecording {
  return loadBundle(path).recording
}

// =============================================================================
// Writing — Recording → bundle dir or sealed archive
// =============================================================================

/** Serialize a Recording into the member map + manifest of an at-rest bundle. */
function serializeRecording(recording: Recording, pngSourceDir?: string): Map<string, Uint8Array> {
  const encoder = new TextEncoder()
  const files = new Map<string, Uint8Array>()
  const members: TtyMember[] = []

  if (recording.commands !== undefined) {
    files.set("commands.jsonl", encoder.encode(toJsonl(recording.commands)))
    members.push({ path: "commands.jsonl", type: "commands", encoding: "jsonl" })
  }
  if (recording.io !== undefined) {
    files.set("io.jsonl", encoder.encode(toJsonl(recording.io)))
    members.push({ path: "io.jsonl", type: "io", encoding: "jsonl" })
  }
  if (recording.frames !== undefined) {
    const traceFrames = recordingToTraceFrames(recording)
    files.set("frames/index.jsonl", encoder.encode(toJsonl(traceFrames)))
    members.push({ path: "frames/index.jsonl", type: "frames", encoding: "trace-index" })
    if (pngSourceDir !== undefined) {
      for (const frame of traceFrames) {
        if (frame.png === null) continue
        const src = join(pngSourceDir, frame.png)
        if (!existsSync(src)) continue
        files.set(`frames/${frame.png}`, new Uint8Array(readFileSync(src)))
      }
    }
  }

  const fingerprint = recording.frames?.[0]?.fingerprint
  const manifest: TtyManifest = {
    ttyVersion: TTY_FORMAT_VERSION,
    recordingVersion: recording.version,
    cols: recording.cols,
    rows: recording.rows,
    durationMicros: recording.durationMicros,
    reproducible: recording.provenance.reproducible,
    ...(fingerprint !== undefined ? { fingerprint } : {}),
    members,
  }
  files.set(MANIFEST_FILE, encoder.encode(JSON.stringify(manifest, null, 2) + "\n"))
  return files
}

/** The per-member compression rule of the sealed encoding: rasters are STORED, text DEFLATES. */
function methodOf(path: string): 0 | 8 {
  return path.endsWith(".png") ? 0 : 8
}

function bundleToZip(files: Map<string, Uint8Array>): Uint8Array {
  const entries: ZipEntry[] = [...files.entries()].map(([path, bytes]) => ({ path, bytes, method: methodOf(path) }))
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return buildZip(entries)
}

/**
 * Write a {@link Recording} to `path` in the encoding the extension names:
 * `.ttyz` — one sealed archive file; `.tty` — an at-rest bundle directory.
 * Anything else refuses loudly — a write names its encoding; reads are the
 * blind side.
 */
export function writeRecording(path: string, recording: Recording, options: WriteRecordingOptions = {}): void {
  const files = serializeRecording(recording, options.pngSourceDir)
  if (isTtyzPath(path)) {
    mkdirSync(join(path, ".."), { recursive: true })
    writeFileSync(path, bundleToZip(files))
    return
  }
  if (isTtyPath(path)) {
    if (existsSync(path)) rmSync(path, { recursive: true, force: true })
    mkdirSync(path, { recursive: true })
    for (const [name, bytes] of files) {
      const dest = join(path, name)
      mkdirSync(join(dest, ".."), { recursive: true })
      writeFileSync(dest, bytes)
    }
    return
  }
  throw new Error(
    `writeRecording: ${path} names neither encoding — write a .tty bundle directory or a .ttyz sealed archive`,
  )
}

// =============================================================================
// Sealing — packRecording / unpackRecording
// =============================================================================

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
 * Seal a `.tty` bundle directory into a single `.ttyz` archive.
 *
 * Sealing is the manifest state transition: a live bundle's open tail rotates
 * into the sealed member list (the path is declarative, so rotation moves the
 * ENTRY, not the bytes), the manifest drops its `tail`, and the members pack
 * into a reproducible ZIP — fixed timestamps, sorted entries, ZIP64 when
 * counts or sizes demand it, rasters STORED, text DEFLATED.
 */
export function packRecording(dir: string, archivePath: string): void {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`packRecording: ${dir} is not a directory`)
  }
  const manifestPath = join(dir, MANIFEST_FILE)
  if (!existsSync(manifestPath)) {
    throw new Error(`packRecording: ${dir} has no manifest.json — not a .tty bundle`)
  }
  const manifest = parseManifest(new Uint8Array(readFileSync(manifestPath)), manifestPath)

  // Rotate the open tail into the sealed member list — a .ttyz never carries one.
  const sealed: TtyManifest = {
    ...manifest,
    members: manifest.tail !== undefined ? [...manifest.members, { ...manifest.tail }] : manifest.members,
  }
  delete sealed.tail

  const entries: ZipEntry[] = []
  for (const path of walk(dir)) {
    const rel = relativeSlash(dir, path)
    if (rel === MANIFEST_FILE) continue // replaced by the sealed manifest below
    entries.push({ path: rel, bytes: new Uint8Array(readFileSync(path)), method: methodOf(rel) })
  }
  entries.push({
    path: MANIFEST_FILE,
    bytes: new TextEncoder().encode(JSON.stringify(sealed, null, 2) + "\n"),
    method: 8,
  })
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  writeFileSync(archivePath, buildZip(entries))
}

/**
 * Unseal a `.ttyz` archive back into a `.tty` bundle directory. The inverse
 * of {@link packRecording}; the destination is wiped and recreated.
 */
export function unpackRecording(archivePath: string, dir: string): void {
  if (!existsSync(archivePath)) {
    throw new Error(`unpackRecording: ${archivePath} does not exist`)
  }
  const entries = parseZip(new Uint8Array(readFileSync(archivePath)))
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  for (const entry of entries) {
    const dest = join(dir, entry.path)
    mkdirSync(join(dest, ".."), { recursive: true })
    writeFileSync(dest, entry.bytes)
  }
}

// =============================================================================
// Extension probes — the only place a name means an encoding
// =============================================================================

/** Whether a path names the bundle (directory) encoding. */
export function isTtyPath(path: string): boolean {
  return basename(path).endsWith(".tty")
}

/** Whether a path names the sealed (archive) encoding. */
export function isTtyzPath(path: string): boolean {
  return basename(path).endsWith(".ttyz")
}
