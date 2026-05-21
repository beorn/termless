---
title: Recording
description: A Recording is a captured terminal session — a timeline of commands, I/O, and frames, serializable to the .tape, .cast, and .rec formats.
---

# Recording

A **Recording** is a captured terminal session: the *captured* counterpart of a
live [Terminal](./terminal). Where a Terminal is a session happening now, a
Recording is that session frozen onto a timeline you can replay, scrub, animate,
and diff.

A Recording is **one concept** — not five. The file formats it serializes to
(`.tape`, `.cast`, `.rec`) are *encodings*, not separate things. Naming the
concept after a serialization would be the JPEG-vs-Photo error: the photo is the
thing; JPEG is one way to store it.

## The three tracks

A Recording is a timeline carrying up to three tracks. Two are **sources** — the
session itself — and one is a **projection** — a derived view of it.

| Track        | Tier                  | Holds                                                                  |
| ------------ | --------------------- | ---------------------------------------------------------------------- |
| **commands** | source — *intent*     | timed high-level instructions: key presses, `Type`, `Sleep`, `Resize`  |
| **io**       | source — *observed*   | timed raw byte events, direction-tagged `in` / `out`                   |
| **frames**   | projection — *derived* | rendered visual states + capture metadata (dirty regions, ANSI, PNG)   |

**commands** and **io** are *causal* — they *are* the session. **commands** is
the intent (what you asked the terminal to do); **io** is the observed truth (the
exact bytes that flowed). **frames** is an *effect* — a materialized view of
`io × Renderer`. A frame can be regenerated; mutating one does not change the
session.

A Recording is valid with any non-empty subset of tracks: a hand-authored
`.tape` carries commands only; a live `record` carries commands + io; a frame
trace adds the frames projection.

### Track authority

When more than one track is present:

- **io** is the authoritative *observation* — `play` uses it for byte-exact
  reproduction.
- **commands** is the authoritative *intent* — `play` defaults to it because it
  is editable.

All tracks share **one monotonic clock in integer microseconds**. Float
timestamps (as `.cast` uses) drift, so termless normalizes them on import.

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
*encodings* — see the [Formats reference](../reference/formats/) for full specs.

| Format     | Role                                                                                  |
| ---------- | ------------------------------------------------------------------------------------- |
| **`.tape`** | charm/VHS interop. A *compiler* input — `.tape` → commands track. Round-trip is lossy. |
| **`.cast`** | asciinema interop. A symmetric *codec* — `.cast` ⇄ io track, lossless.                 |
| **`.rec`** | termless's own native format — a single-file container carrying all three tracks losslessly. |

`.tape` is special: it is a *scenario compiler*, not a symmetric codec. `Type "hi"`
*expands* into key events with timing; `Sleep` is a player directive. Going back
out (Recording → `.tape`) is best-effort. `.cast` is a true codec — the io track
round-trips losslessly. `.rec` is termless's lossless canonical form.

For how-to material see the [Recording Sessions](../guide/recording-sessions)
and [Tracing Visual Bugs](../guide/tracing-visual-bugs) guides.
