/**
 * The in-memory Trace model — termless's multi-track captured-session type.
 *
 * A **Trace** is a captured terminal session: a timeline carrying two
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
 * is the authoritative intent.** `play` automatically prefers a non-empty
 * `commands` track (editable), otherwise discloses its fallback to `io`
 * (byte-exact); `--source` forces either track and refuses when it is absent.
 *
 * Timebase — every timestamp on every track is **integer microseconds** on a
 * single monotonic clock. Never a float. asciicast's float-second timestamps
 * are normalized to integer µs on import (see {@link secondsToMicros}).
 *
 * Why `Trace`, not `Recording`: the unterm design settles on "one event
 * vocabulary, several containers" — `Recording` now names
 * the single-track container, a header plus the Events (`@termless/core/io`,
 * `src/io/recording.ts`). This type is the *other* container over the same
 * event vocabulary: several source tracks plus a projection. Two structs
 * answering to one name was the bug unterm phase A3 fixes; `Recording` stays
 * exported below as a `@deprecated` alias of `Trace` through phase A4a, when
 * the alias is deleted and the root barrel's `Recording` becomes the io shape.
 *
 * This is `recording/recording.ts` — the canonical multi-track captured-
 * session model. The legacy fragmented artifacts (the old `recording.ts`,
 * `asciicast/convert`) were purged in Phase 6A; this `Trace` type owns the
 * concept. The format codecs live alongside it: `asciicast/recording-codec.ts`
 * (the `.cast` codec), `tape/compile.ts` (the `.tape` compiler),
 * `native/tty-format.ts` (`.tty`/`.ttyz`), `ttyrec/recording-codec.ts`
 * (`ttyrec` import).
 */

// =============================================================================
// Timebase — integer microseconds, single monotonic clock
// =============================================================================
//
// The timebase is declared in `src/io/time.ts` (which depends on nothing) and
// re-exported here. There is exactly one `Micros` brand in the package; every
// existing import of `Micros` / `micros` / `secondsToMicros` / `millisToMicros`
// from this module keeps working.

export type { Micros } from "../io/time.ts"
export { micros, millisToMicros, secondsToMicros } from "../io/time.ts"

import type { Micros } from "../io/time.ts"

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
 *
 * @deprecated REMOVING in unterm phase A4 — an Event's own `type` says which
 * direction it went (`"output"` / `"input"`), so the separate direction tag
 * disappears. See `Event` in `@termless/core/io`.
 */
export type IoDirection = "in" | "out"

/**
 * A single timed raw byte event on the `io` track.
 *
 * `io` is the *observed truth*: re-feeding it to the parser reproduces the
 * session byte-exactly. `at` is on the recording's monotonic µs clock;
 * `direction` is mandatory.
 *
 * @deprecated REMOVING in unterm phase A4 — replaced by `Event`
 * (`@termless/core/io`), one union covering output, input, control, mark and
 * exit rather than bytes only. Not a true alias: `Event` discriminates on
 * `type` instead of carrying a separate `direction`, and its `data` is
 * `Uint8Array` rather than a decoded string. Convert with `eventFromIoEvent`
 * / `ioEventFromEvent` in `recording/io-compat.ts`.
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
 * Render-capture artifacts attached to a {@link Frame} of a *visual trace*.
 *
 * A visual trace (the frame tracer's on-disk `index.jsonl` row, {@link
 * "./frame-trace.ts" | TraceFrame}) carries two facts the projection cannot
 * derive from the timeline alone: the **wall-clock capture instant** and the
 * **render cost** of the frame's PNG. The Recording model's `at` is a
 * *normalized* µs-from-start position — a different fact from the absolute
 * capture clock — so these live in a small artifacts bag rather than being
 * folded into `at`.
 *
 * Carrying them here is what makes the `frames` projection the **lossless
 * carrier** of a visual trace (ruling: *TraceFrame = Recording-frame + render
 * artifacts*): a trace round-trips `TraceFrame[] → Recording → TraceFrame[]`
 * byte-for-byte through the symmetric codec pair in `frame-trace-recording.ts`.
 *
 * Present only on frames that came from a render trace; **absent** on frames
 * derived from an `io` track (which have no capture clock or render cost).
 */
export interface RenderArtifacts {
  /**
   * The wall-clock capture instant — ms since the Unix epoch. This is the
   * on-disk trace's absolute `ts`; `iso` and inter-frame `duration` derive
   * from it. Distinct from {@link Frame.at}, which is µs from recording start.
   */
  wallClockMs: number
  /**
   * Milliseconds the PNG render for this frame took. `0` for a visual
   * duplicate or a metadata-only capture (no PNG was rendered).
   */
  renderMs: number
}

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
  /**
   * Render-capture artifacts — {@link RenderArtifacts}. Present when this frame
   * came from a *visual trace* (the frame tracer); absent on frames derived
   * from an `io` track. Carrying them keeps the projection a lossless carrier
   * of a visual trace — see {@link RenderArtifacts}.
   */
  artifacts?: RenderArtifacts
}

// =============================================================================
// Trace — two source tracks + one projection
// =============================================================================

/**
 * Provenance about whether a Trace's frames projection can be regenerated.
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
 * Named `Trace`, not `Recording`: the unterm design settles on "one event
 * vocabulary, several containers" — `Recording` is
 * the single-track container (a header plus the Events, `@termless/core/io`);
 * `Trace` is this package's other container over the same vocabulary: several
 * tracks plus a projection. See the file header above for the full story.
 *
 * A Trace is **valid with any non-empty subset of members**:
 *
 *  - `commands` only — a hand-authored tape (intent, no observed output).
 *  - `commands` + `io` — a live record.
 *  - `commands` + `io` + `frames` — a *trace*.
 *  - `io` only — a decoded `.cast`.
 *
 * Use {@link createTrace} to construct one (it validates the non-empty
 * invariant) and {@link trackAuthority} to ask which track is authoritative.
 */
export interface Trace {
  /** Trace model version. */
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
 * @deprecated Renamed to {@link Trace}. `Recording` now names the single-track
 * io container (`@termless/core/io`, `src/io/recording.ts`); this alias keeps
 * every existing import of the multi-track shape working until unterm phase
 * A4a deletes it and the root barrel's `Recording` becomes the io shape.
 */
export type Recording = Trace

/**
 * The track authority of a Trace — which track, if any, is the
 * authoritative answer for a given question.
 *
 *  - `observation` — the authoritative *observed truth*: `"io"` when an io
 *    track exists, else `null`.
 *  - `intent` — the authoritative *intent*: `"commands"` when a commands track
 *    exists, else `null`.
 *
 * Automatic `play` follows `intent` when it exists, otherwise `observation`;
 * an explicit source selection follows only the requested authority.
 */
export interface TrackAuthority {
  observation: "io" | null
  intent: "commands" | null
}

// =============================================================================
// Construction + accessors
// =============================================================================

/** Input to {@link createTrace} — at least one track member is required. */
export interface CreateTraceInput {
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
 * @deprecated Renamed to {@link CreateTraceInput}. Kept as a transparent
 * alias through unterm phase A4a.
 */
export type CreateRecordingInput = CreateTraceInput

/**
 * Construct a {@link Trace}, enforcing the non-empty-subset invariant.
 *
 * Throws when none of `commands` / `io` / `frames` is present — a Trace
 * with no tracks is not a recording.
 */
export function createTrace(input: CreateTraceInput): Trace {
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
 * @deprecated Renamed to {@link createTrace}. Kept as a transparent alias —
 * same input shape, same validation, same error text — through unterm phase
 * A4a, when this wrapper and the deprecated `Recording` alias are deleted
 * together.
 */
export function createRecording(input: CreateRecordingInput): Recording {
  return createTrace(input)
}

/**
 * Report the {@link TrackAuthority} of a Trace.
 *
 * Encodes the track-authority rule: `io` is the authoritative observation,
 * `commands` is the authoritative intent. A track is authoritative only when
 * it is present and non-empty.
 */
export function trackAuthority(trace: Trace): TrackAuthority {
  const hasIo = trace.io !== undefined && trace.io.length > 0
  const hasCommands = trace.commands !== undefined && trace.commands.length > 0
  return {
    observation: hasIo ? "io" : null,
    intent: hasCommands ? "commands" : null,
  }
}
