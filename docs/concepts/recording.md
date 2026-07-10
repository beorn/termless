---
title: Recording
description: A Recording is a captured terminal session — a timeline of commands, I/O, and frames, serializable to the .tape, .cast, and .rec formats.
---

# Recording

A **Recording** is a captured terminal session: the _captured_ counterpart of a
live [Terminal](./terminal). Where a Terminal is a session happening now, a
Recording is that session frozen onto a timeline you can replay, scrub, animate,
and diff.

A Recording is **one concept** — not five. The file formats it serializes to
(`.tape`, `.cast`, `.rec`) are _encodings_, not separate things. Naming the
concept after a serialization would be the JPEG-vs-Photo error: the photo is the
thing; JPEG is one way to store it.

## The three tracks

A Recording is a timeline carrying up to three tracks. Two are **sources** — the
session itself — and one is a **projection** — a derived view of it.

| Track        | Tier                   | Holds                                                                 |
| ------------ | ---------------------- | --------------------------------------------------------------------- |
| **commands** | source — _intent_      | timed high-level instructions: key presses, `Type`, `Sleep`, `Resize` |
| **io**       | source — _observed_    | timed raw byte events, direction-tagged `in` / `out`                  |
| **frames**   | projection — _derived_ | rendered visual states + capture metadata (dirty regions, ANSI, PNG)  |

**commands** and **io** are _causal_ — they _are_ the session. **commands** is
the intent (what you asked the terminal to do); **io** is the observed truth (the
exact bytes that flowed). **frames** is an _effect_ — a materialized view of
`io × Renderer`. A frame can be regenerated; mutating one does not change the
session.

A Recording is valid with any non-empty subset of tracks: a hand-authored
`.tape` carries commands only; a live `record` carries commands + io; a frame
trace adds the frames projection.

### Track authority

When more than one track is present:

- **io** is the authoritative _observation_ — `play` uses it for byte-exact
  reproduction.
- **commands** is the authoritative _intent_ — `play` defaults to it because it
  is editable.

All tracks share **one monotonic clock in integer microseconds**. Float
timestamps (as `.cast` uses) drift, so termless normalizes them on import.

## Visual traces are a Recording projection

A **visual trace** — the frame tracer's on-disk directory (`index.jsonl` +
`NNNNN.png`, one `TraceFrame` row per line) — is not a parallel format sitting
_beside_ a Recording. It **is** a Recording whose `frames` projection is
populated. `TraceFrame`, the on-disk row, is the _serialization_ of one frame
plus its **render artifacts**: the wall-clock capture instant and the
per-frame render cost (`render_ms`). Those two facts are the only things a
rendered frame carries that the timeline cannot derive, so the projection
carries them in a small `artifacts` bag on each `Frame` — and with them, the
`frames` projection is the **lossless carrier** of a visual trace.

```
TraceFrame (on-disk row)  ⇄  Frame (projection entry) + RenderArtifacts
```

The conversion is one symmetric codec pair — `traceToRecording` (rows →
Recording) and `recordingToTraceFrames` (Recording → rows). Every consumer that
needs the on-disk shape routes through that one pair: the `.rec` writer, the
`writeVisualTraceFromRecording` disk writer, and the browser viewer. There is
no second Frame → row projection. Because the artifacts survive the round trip,
`recordingToTraceFrames(traceToRecording(rows))` reproduces `rows`
byte-for-byte, so a trace can be written straight from the canonical Recording
noun and the bytes are identical to what the raw-`TraceFrame[]` path would
write. (The one exception: a frame annotated with a silvery render-join event
keeps only the dependency-free subset of that event on the projection's
`signal` field, so a silvery-annotated trace is not byte-lossless on that one
field. Traces recorded without a silvery sidecar — the default — round-trip
exactly.)

The naming follows the program's rule that **visual/recording things are
frames** (not "messages", which are wire things): `Frame`, `TraceFrame`,
`RenderArtifacts`.

## The verbs

Everything you do with a Recording is one of the [four verbs](./overview):

- **record** captures a Terminal into a Recording. `record --frames` opts into
  populating the frames projection.
- **view** presents a Recording — scrub it in a browser, animate it to a
  GIF/APNG/SVG, or embed it with the web player.
- **play** re-executes a Recording into a Terminal — `--source=commands`
  (default, editable) or `--source=io` (byte-exact).
- **compare** diffs one Recording across N backends.

## Formats

A Recording serializes to and from three on-disk formats. Formats are
_encodings_ — see the [Formats reference](../reference/formats/) for full specs.

| Format      | Role                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------- |
| **`.tape`** | charm/VHS interop. A _compiler_ input — `.tape` → commands track. Round-trip is lossy.       |
| **`.cast`** | asciinema interop. A symmetric _codec_ — `.cast` ⇄ io track, lossless.                       |
| **`.rec`**  | termless's own native format — a single-file container carrying all three tracks losslessly. |

`.tape` is special: it is a _scenario compiler_, not a symmetric codec. `Type "hi"`
_expands_ into key events with timing; `Sleep` is a player directive. Going back
out (Recording → `.tape`) is best-effort. `.cast` is a true codec — the io track
round-trips losslessly. `.rec` is termless's lossless canonical form.

For how-to material see the [Recording Sessions](../guide/recording-sessions)
and [Tracing Visual Bugs](../guide/tracing-visual-bugs) guides.
