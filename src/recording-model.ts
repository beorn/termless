/**
 * The in-memory Recording model — termless's unified captured-session type.
 *
 * A **Recording** is a captured terminal session: a timeline carrying two
 * **source tracks** and one **projection**.
 *
 *  - `commands` — a *source track* of timed high-level instructions (key
 *    presses, `Type`, `Sleep`, `Resize`, `Set`, `Screenshot`). Replayable
 *    *intent*.
 *  - `io` — a *source track* of timed raw byte events, each direction-tagged
 *    `"in" | "out"` (mirroring asciicast v2's `i`/`o`). The observed *truth*.
 *  - `frames` — a *projection* (NOT a co-equal track): rendered visual states
 *    plus capture metadata. A materialized view of `io × Renderer ×
 *    snapshot-policy`, regenerable and revalidatable.
 *
 * Track authority — the invariant that makes `play` deterministic: when
 * multiple tracks exist, **`io` is the authoritative observation; `commands`
 * is the authoritative intent.** `play` defaults to `commands` (editable);
 * `reproduce` uses `io` (byte-exact).
 *
 * Timebase — every timestamp on every track is **integer microseconds** on a
 * single monotonic clock. Never a float. asciicast's float-second timestamps
 * are normalized to integer µs on import (see {@link secondsToMicros}).
 *
 * Phase 1 of the Recording-domain unification (see the design doc §3, §6).
 * This is the **substrate phase**: the new model is defined here *alongside*
 * the legacy `recording.ts` / tape / asciicast artifacts. Nothing old is
 * deleted or changed; no consumer is migrated. Phases 2–6 do the migration.
 *
 * TEMPORARY MODULE NAME — Phase 6 reorg moves this to `recording/recording.ts`
 * and resolves the `Recording` name collision with the legacy
 * `src/recording.ts` export (which still owns the public `Recording` symbol
 * for now). Until then this type lives here under its own module so both can
 * coexist. Do not migrate consumers onto this type before Phase 2.
 */

// =============================================================================
// Timebase — integer microseconds, single monotonic clock
// =============================================================================

/**
 * A timestamp on a Recording's monotonic clock.
 *
 * **Integer microseconds** relative to recording start. This is a branded
 * `number`: the brand exists only at the type level (it is erased at runtime)
 * and forces every timestamp to pass through {@link micros} or
 * {@link secondsToMicros} / {@link millisToMicros}, so a stray float can never
 * be assigned where the model expects µs.
 */
export type Micros = number & { readonly __brand: "Micros" }

/**
 * Brand a raw integer as a {@link Micros} timestamp.
 *
 * Throws if the value is not a non-negative integer — the model never carries
 * a float timestamp, and this is the choke point that enforces it.
 */
export function micros(value: number): Micros {
  if (!Number.isInteger(value)) {
    throw new Error(`Recording timestamps must be integer microseconds, got: ${value}`)
  }
  if (value < 0) {
    throw new Error(`Recording timestamps must be non-negative, got: ${value}`)
  }
  return value as Micros
}

/**
 * Normalize an asciicast-style float-second timestamp to integer µs.
 *
 * asciicast v2 records `time` as a float in seconds; this is the import
 * normalizer that converts it to the Recording model's integer-µs timebase.
 * Rounds to the nearest microsecond — there is no float left afterwards.
 */
export function secondsToMicros(seconds: number): Micros {
  return micros(Math.round(seconds * 1_000_000))
}

/**
 * Normalize a millisecond timestamp (e.g. legacy `recording.ts` events,
 * `.tape` `Sleep` durations) to integer µs.
 */
export function millisToMicros(ms: number): Micros {
  return micros(Math.round(ms * 1_000))
}

// =============================================================================
// Renderer fingerprint — what a frame projection was rendered against
// =============================================================================

/**
 * A fingerprint of the Renderer strategy + environment a frame was rendered
 * against. Stored on every {@link Frame} so the projection can be
 * *revalidated* (does it still match the current renderer?) and *regenerated*
 * (re-render `io` with the same fingerprint) — see the design doc §3.
 *
 * When the live renderer's fingerprint differs from a frame's, that frame is
 * marked stale but stays scrubbable.
 */
export interface RendererFingerprint {
  /** Backend id the frame was rendered with (e.g. `"ghostty"`, `"vterm"`). */
  backend: string
  /** Font family / face used by the rasterizer. */
  fontFamily: string
  /** Font size in points. */
  fontSize: number
  /** Cell size in device pixels — `{ width, height }`. */
  cellSize: { width: number; height: number }
  /** Device pixel ratio (DPI scaling) the frame was rasterized at. */
  dpr: number
  /** Theme identifier (name or content hash) the frame used. */
  theme: string
}

// =============================================================================
// commands — the intent source track
// =============================================================================

/**
 * A single timed high-level instruction on the `commands` track.
 *
 * `commands` houses heterogeneity: terminal input (`type`, `key`, `ctrl`,
 * `alt`), player directives (`sleep`, `screenshot`), and environment changes
 * (`resize`, `set`). It is the *intent* track — replayable, editable, and the
 * default source for `play`. The unified shape later phases converge
 * `TapeCommand` onto.
 *
 * Discriminated on `kind`. `at` is the command's position on the recording's
 * monotonic µs clock.
 */
export type Command =
  | { kind: "type"; at: Micros; text: string; speedMicros?: Micros }
  | { kind: "key"; at: Micros; key: string; count?: number }
  | { kind: "ctrl"; at: Micros; key: string }
  | { kind: "alt"; at: Micros; key: string }
  | { kind: "sleep"; at: Micros; durationMicros: Micros }
  | { kind: "resize"; at: Micros; cols: number; rows: number }
  | { kind: "set"; at: Micros; key: string; value: string }
  | { kind: "screenshot"; at: Micros; path?: string }

// =============================================================================
// io — the observed-truth source track
// =============================================================================

/**
 * The direction of a raw byte event on the `io` track.
 *
 *  - `"in"`  — bytes sent *to* the terminal (user/program input).
 *  - `"out"` — bytes received *from* the terminal (program output).
 *
 * Mirrors asciicast v2's `i` / `o` event discriminator. The `io` track is
 * direction-blind without this tag, so every event MUST carry it.
 */
export type IoDirection = "in" | "out"

/**
 * A single timed raw byte event on the `io` track.
 *
 * `io` is the *observed truth*: re-feeding it to the parser reproduces the
 * session byte-exactly. `at` is on the recording's monotonic µs clock;
 * `direction` is mandatory.
 */
export interface IoEvent {
  /** Position on the recording's monotonic µs clock. */
  at: Micros
  /** Whether these bytes went in to, or came out of, the terminal. */
  direction: IoDirection
  /** The raw byte payload, decoded as a string (UTF-8). */
  data: string
}

// =============================================================================
// frames — the derived projection
// =============================================================================

/**
 * A single rendered visual state on the `frames` projection.
 *
 * `frames` is a **projection**, not a co-equal source track: it is a
 * materialized view of `io × Renderer × snapshot-policy`. The *visual* part
 * regenerates from `io + Renderer`; the *capture metadata* (`signalDelta`,
 * `dirtyRegions`) is recorded, not derivable — which is why the projection
 * stays *in* the Recording rather than being computed on demand.
 *
 * Each frame carries a {@link RendererFingerprint} + a `contentHash` so it can
 * be revalidated and regenerated. This is the unified, canonical frame shape;
 * the on-disk frame-trace index row (`TraceFrame`) is a serialization detail.
 */
export interface Frame {
  /** 1-based sequence number within the projection. */
  seq: number
  /** Position on the recording's monotonic µs clock. */
  at: Micros
  /**
   * Content hash of the rendered buffer state (cells + cursor + modes).
   * Identical visual states share a hash — the basis for dedup.
   */
  contentHash: string
  /**
   * `seq` of the earlier frame this one is a visual duplicate of, or `null`
   * when this frame is itself unique.
   */
  duplicateOf: number | null
  /** The Renderer strategy + environment this frame was rendered against. */
  fingerprint: RendererFingerprint
  /** Buffer geometry + cursor at capture time. */
  buffer: {
    cols: number
    rows: number
    cursor: { row: number; col: number }
  }
  /** A short ANSI preview of the input that produced this frame. */
  ansiPreview: string
  /** Raw input byte count accumulated since the previous frame. */
  bytesInSinceLast: number
  /**
   * Reference to the rendered PNG for this frame — a path relative to the
   * recording bundle, or `null` for a frame with no rasterized image
   * (a visual duplicate, or a metadata-only capture).
   */
  png: string | null
  /**
   * Optional silvery render-state snapshot (signal delta + dirty regions).
   * This is the *capture metadata* that is recorded, not derivable. Kept
   * structural so the recording model stays dependency-free of silvery.
   */
  signal?: {
    dirtyRegions: { row: number; height: number }[]
    signalDelta: {
      nodesVisited: number
      nodesRendered: number
      nodesSkipped: number
      incremental: boolean
    }
  }
}

// =============================================================================
// Recording — two source tracks + one projection
// =============================================================================

/**
 * Provenance about whether a Recording's frames projection can be regenerated.
 *
 * Some sessions (custom renderers, non-deterministic programs) cannot
 * regenerate `frames` from `io`. When `reproducible` is `false`, the `frames`
 * projection is the *only* record of the visual state — not a cache — and a
 * `validate()` pass must treat it as authoritative rather than derivable.
 * (Design doc §9 — spec the flag in Phase 1.)
 */
export interface RecordingProvenance {
  /**
   * `true` when the `frames` projection can be regenerated by re-rendering the
   * `io` track. `false` for sessions whose visual state is not reproducible —
   * then `frames` is the sole record. Defaults to `true`.
   */
  reproducible: boolean
}

/**
 * A captured terminal session — two source tracks and one projection on a
 * single monotonic µs timeline.
 *
 * A Recording is **valid with any non-empty subset of members**:
 *
 *  - `commands` only — a hand-authored tape (intent, no observed output).
 *  - `commands` + `io` — a live record.
 *  - `commands` + `io` + `frames` — a *trace*.
 *  - `io` only — a decoded `.cast`.
 *
 * Use {@link createRecording} to construct one (it validates the non-empty
 * invariant) and {@link trackAuthority} to ask which track is authoritative.
 */
export interface Recording {
  /** Recording model version. */
  version: 1
  /** Terminal dimensions at recording start. */
  cols: number
  /** Terminal dimensions at recording start. */
  rows: number
  /** Total duration in integer µs. */
  durationMicros: Micros
  /**
   * The `commands` source track — timed intent. `undefined` when the
   * recording carries no command track (e.g. a decoded `.cast`).
   */
  commands?: Command[]
  /**
   * The `io` source track — timed observed truth. `undefined` when the
   * recording carries no io track (e.g. a hand-authored `.tape`).
   */
  io?: IoEvent[]
  /**
   * The `frames` projection — derived visual states. `undefined` when the
   * recording has not been rendered into frames.
   */
  frames?: Frame[]
  /** Whether the frames projection is regenerable from the io track. */
  provenance: RecordingProvenance
}

/**
 * The track authority of a Recording — which track, if any, is the
 * authoritative answer for a given question.
 *
 *  - `observation` — the authoritative *observed truth*: `"io"` when an io
 *    track exists, else `null`.
 *  - `intent` — the authoritative *intent*: `"commands"` when a commands track
 *    exists, else `null`.
 *
 * `play` follows `intent`; `reproduce` follows `observation`.
 */
export interface TrackAuthority {
  observation: "io" | null
  intent: "commands" | null
}

// =============================================================================
// Construction + accessors
// =============================================================================

/** Input to {@link createRecording} — at least one track member is required. */
export interface CreateRecordingInput {
  cols: number
  rows: number
  durationMicros: Micros
  commands?: Command[]
  io?: IoEvent[]
  frames?: Frame[]
  /** Provenance; defaults to `{ reproducible: true }`. */
  provenance?: RecordingProvenance
}

/**
 * Construct a {@link Recording}, enforcing the non-empty-subset invariant.
 *
 * Throws when none of `commands` / `io` / `frames` is present — a Recording
 * with no tracks is not a recording.
 */
export function createRecording(input: CreateRecordingInput): Recording {
  const hasCommands = input.commands !== undefined && input.commands.length > 0
  const hasIo = input.io !== undefined && input.io.length > 0
  const hasFrames = input.frames !== undefined && input.frames.length > 0
  if (!hasCommands && !hasIo && !hasFrames) {
    throw new Error("A Recording must carry at least one non-empty track (commands, io, or frames).")
  }
  return {
    version: 1,
    cols: input.cols,
    rows: input.rows,
    durationMicros: input.durationMicros,
    ...(input.commands !== undefined ? { commands: input.commands } : {}),
    ...(input.io !== undefined ? { io: input.io } : {}),
    ...(input.frames !== undefined ? { frames: input.frames } : {}),
    provenance: input.provenance ?? { reproducible: true },
  }
}

/**
 * Report the {@link TrackAuthority} of a Recording.
 *
 * Encodes the track-authority rule: `io` is the authoritative observation,
 * `commands` is the authoritative intent. A track is authoritative only when
 * it is present and non-empty.
 */
export function trackAuthority(recording: Recording): TrackAuthority {
  const hasIo = recording.io !== undefined && recording.io.length > 0
  const hasCommands = recording.commands !== undefined && recording.commands.length > 0
  return {
    observation: hasIo ? "io" : null,
    intent: hasCommands ? "commands" : null,
  }
}
