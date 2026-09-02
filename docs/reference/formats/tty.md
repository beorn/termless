---
title: .tty / .ttyz Format Reference
description: One recording format, two encodings — the live bundle directory and the sealed archive — read by one encoding-blind reader.
---

# `.tty` / `.ttyz` Format Reference

`.tty` / `.ttyz` is **one format with two encodings** — the way a container
image is one layout whether it lives as a directory of blobs or a `docker save`
tarball:

- **`.tty`** — the recording **bundle**: a plain directory
  (`mysession.tty/`) holding a manifest and the recording's members as
  ordinary files. This is the **live** encoding — a session under capture
  appends to an open tail segment inside the bundle — and the source-of-truth
  encoding at rest. Uncompressed, full stop: recovery and tail-follow stay
  trivial on plain appended bytes.
- **`.ttyz`** — the **sealed** encoding: the same members packed into a single
  ZIP container (ZIP64-capable). Portable, immutable, seekable. Compression
  happens only at seal — a ZIP's central directory is written at close, which
  is why the sealed form seals.

**One reader, both encodings, encoding-blind consumers.** `readRecording`
accepts a live `.tty` bundle directory or a sealed `.ttyz` file — nothing
else — and produces an identical [Recording](../../concepts/recording) from
either. No downstream consumer can tell which encoding it was handed;
`packRecording` / `unpackRecording` are the only places encoding exists as a
concept.

`.tty`/`.ttyz` supersedes the retired `.rec` container. `.rec` was deleted,
not aliased: no `.rec` artifact was ever shipped, so there is nothing to
migrate.

## The bundle layout

```
mysession.tty/                  ← the bundle: live, or sealed-at-rest
  manifest.json                 ← the member index (see below)
  commands.jsonl                ← a commands member  (optional)
  io.jsonl                      ← an io member, jsonl encoding (optional)
  io/000…000-000…123.hts        ← an io member, hts1 encoding (optional, many)
  io/current                    ← the open tail of a LIVE bundle (at most one)
  facts/000…000-000…456.jsonl   ← a facts member (optional, many)
  habcp.log                     ← a habcp member: the habitat journal's live tail (optional)
  habcp-000…001-000…456.log     ← habcp members: sealed journal segments (optional, many)
  frames/index.jsonl            ← a frames member (optional)
  frames/00001.png              ← frame rasters, beside their index
  checkpoints/000…123.json      ← checkpoint members (optional, many)
```

Member **paths are declarative**: the manifest names each member's path, type,
and encoding, and the reader dispatches on the manifest — never on file-name
conventions. A frames member may live at `frames/index.jsonl` or at the bundle
root as `index.jsonl`; both are valid bundles because the manifest says where
to look. (This is what makes an upgraded legacy frame-trace directory — its
`index.jsonl` and PNGs byte-identical, plus one added `manifest.json` — a
valid `.tty` bundle with zero artifact churn.)

## `manifest.json`

```jsonc
{
  "ttyVersion": 1, // format version of this manifest schema
  "recordingVersion": 1, // Recording model version
  "cols": 80, // terminal columns at recording start
  "rows": 24, // terminal rows at recording start
  "durationMicros": 5200000, // total duration, integer µs
  "reproducible": true, // frames projection regenerable from io?
  "originWallMs": 1754620000000, // OPTIONAL: wall-clock ms of µs-origin 0
  "fingerprint": {
    /* RendererFingerprint */
  }, // OPTIONAL, frames-bearing only

  // Sealed members. Every listed member is complete and immutable.
  "members": [
    { "path": "io.jsonl", "type": "io", "encoding": "jsonl" },
    {
      "path": "io/00000000000000000000-00000000000000012345.hts",
      "type": "io",
      "encoding": "hts1",
      "micros": [0, 3100000],
    }, // OPTIONAL: time range covered, µs
    { "path": "facts/00000000000000000000-00000000000000000456.jsonl", "type": "facts", "encoding": "jsonl" },
    { "path": "commands.jsonl", "type": "commands", "encoding": "jsonl" },
    { "path": "frames/index.jsonl", "type": "frames", "encoding": "trace-index" },
    { "path": "checkpoints/00000000000000012345.json", "type": "checkpoint", "encoding": "json" },
  ],

  // The ONE open segment of a LIVE bundle. Absent in a sealed bundle —
  // sealing rotates the tail into `members`. Tail-follow readers poll this
  // file; its bytes are append-only between manifest rewrites.
  "tail": { "path": "io/current", "type": "io", "encoding": "hts1" },
}
```

- The manifest is written **atomically** (write-temp + rename) and rewritten
  only on member rotation or seal — never per append. Appends go to the tail
  file; the manifest names it once.
- A bundle with a `tail` is **live**; a bundle without one is **at rest**.
  Sealing = rotate the tail into `members`, drop `tail`, then (for `.ttyz`)
  pack.
- `micros` ranges are on the recording's monotonic µs clock and are
  advisory acceleration for windowed reads; the member bytes are
  authoritative.
- `originWallMs` anchors the µs origin to a wall clock. It is **required**
  when any member's encoding stamps wall-clock time (`hts1`); the reader
  rebases those stamps onto the µs clock against this origin. When absent,
  the first event of the earliest `hts1` member defines µs 0. Disclosure:
  a consumer that reports times states which clock they came from.

### Member types

| type         | carries                                                                   | → Recording                                               |
| ------------ | ------------------------------------------------------------------------- | --------------------------------------------------------- |
| `io`         | direction-tagged raw byte events                                          | `io` track                                                |
| `commands`   | timed intent (keys, resize, sleeps)                                       | `commands` track                                          |
| `frames`     | rendered frame index + rasters                                            | `frames` projection                                       |
| `facts`      | session fact events (annotation source)                                   | _not loaded_ — exposed to annotation/windowed readers     |
| `habcp`      | the habitat's control-plane journal (NDJSON rows; tail + sealed segments) | _not loaded_ — opaque; hab-side readers own row semantics |
| `checkpoint` | serialized terminal state at an offset                                    | _not loaded_ — seek keyframes for players and reattach    |

`facts` and `checkpoint` members are first-class bundle members that the
Recording model deliberately does not carry: facts are the annotation source
(verdicts and extracted facts are sidecars, never mutations of the artifact),
and checkpoints are derived seek keyframes (streams are stored; snapshots are
derived). `readBundle` surfaces them; `readRecording` returns the Recording
and **tallies** what it did not load — never a silent skip.

`habcp` members are DELIBERATELY OPAQUE at this layer: this format knows the
kind string and that the content is one JSON object per line, and nothing
else — no habcp row schema crosses into this spec or its readers (the same
layering law that keeps this format vterm-free). The session fact lane and
every row semantic are defined hab-side; see the habitat's own `habcp.md`
specification. A `habcp` member naming the journal's live tail (`habcp.log`)
is the one declared mutable member — consumers read it to EOF.

### Loading as an io Recording

The table above is the **Trace-shaped** door (`readBundle`/`readRecording`,
`recording/recording.ts`'s commands + io + frames tracks). `loadBundle` /
`loadRecording` (`recording/native/tty-format.ts`) load the same manifest
into the **io-shaped** Recording instead — a header plus `Event[]`
(`@termless/core/io`) — minted under a new name in unterm phase A3 slice 5;
`readRecording` itself takes over this shape at phase A4a, when the Trace
alias is deleted (the two names coincide from that point on).

| member                                           | → io Event                                                                                                                                           |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `io`, `hts1` encoding — `output`/`input`         | one Event per frame, the **raw payload bytes** as `data` — no UTF-8 decode                                                                           |
| `io`, `hts1` encoding — `resize`                 | a **captured, non-derived** `control`/`resize` Event — the source recorded it, the same frame the Trace door reads into its `commands` track         |
| `io`, `hts1` encoding — `lifecycle`/`truncation` | no Event form (same as the Trace door) — tallied                                                                                                     |
| `io`, `jsonl` encoding                           | each row through `eventFromIoEvent`                                                                                                                  |
| `commands`, `frames`, `facts`, `habcp`           | not loaded — tallied by path, the same treatment `readBundle` gives them today                                                                       |
| `checkpoint`                                     | **loaded**: a derived `mark` per record, plus a derived `control`/`resize` on a geometry change — see [Checkpoint member](#checkpoint-member) below |

Checkpoint members are loaded (unterm A3 slice 5b) — see
[Checkpoint member](#checkpoint-member) below for the record contract (D7)
and the mark / derived-resize rules (D8, D9; `@cto` ruling Q1: reconstruction
is marked, capture is not).

**The `derived` rule**: `output`/`input` events never carry `derived` — they
are always a byte-for-byte capture, hts1 or jsonl. A captured hts1 `resize`
frame _also_ carries no `derived` — it happened, exactly as recorded, same as
`output`/`input`. `derived: true` is reserved for events this door
_reconstructs_ from other evidence rather than reads directly off the wire:
a checkpoint record's `mark`, and the `control`/`resize` D9 sometimes
synthesizes beside it — see [Checkpoint member](#checkpoint-member) below.

**The `sourceResolution` rule** (unterm A3 ruling: declared, never assumed):
`"ms"` when any loaded `io` member is `hts1`; `"us"` otherwise — decided by
the `io` members alone, never by a checkpoint's derived `mark`/`control`
Events. A bundle with no events at all throws; see below.

**What is tallied** — `TtyLoadSkipped`: the `commands` / `frames` / `facts` /
`habcp` member paths not loaded at all, plus `lifecycle` / `truncation`
counts for hts1 frames with no Event form. Never a silent drop. `checkpoint`
member paths are no longer part of this tally — they are loaded (see
[Checkpoint member](#checkpoint-member) below).

A bundle that yields no events at all (frames-only, commands-only, or a
checkpoint member with zero records) throws, naming the members it has — the
io shape has nothing to say about it.

### Checkpoint member

The normative record contract (D7), and the mark / derived-resize rules this
door applies to it (D8, D9; unterm A3 slice 5b). The only real producer is
hab-tty: one `checkpoint` member whose JSON content is a single record or a
JSON array of records.

```typescript
interface TtyCheckpointRecord {
  at: number // wall-ms, rebased exactly like an hts1 frame
  reason?: string
  throughOffset?: number // the journal offset this checkpoint covers through (inclusive)
  size?: { cols: number; rows: number } // write-new: the hab producer adds this in a later slice
  snapshot?: unknown // a vterm.js Snapshot — raw v1, or a v2 envelope `{ format, data }`
}
```

`snapshot` is never decoded — this format imports no engine (see
[Member encodings](#member-encodings) below) — so a record's **geometry**
(D7) is resolved without it wherever possible:

- `size`, when present, wins outright.
- Else, when `snapshot` is a **raw v1** snapshot — a plain object
  `{ version: 1, cols, rows, … }`, not a `{ format, data }` envelope — its
  own top-level `cols`/`rows`: two fields vterm.js documents as that shape's
  persisted wire form, read as JSON and never decoded.
- Else the geometry is unknown, and no derived resize can be computed from
  that record.

**Marks (D8).** Every record becomes one `derived: true` `mark` Event, named
`checkpoint:<reason>` when the record has one, else `checkpoint:<n>` — its
0-based index within its member's JSON document. The mark is anchored onto
the timeline by `throughOffset` when the record declares one _and_ at least
one loaded `io` event carries an hts1 frame offset at all: onto the last such
event whose offset is ≤ `throughOffset`, taking that event's own `at`. In
every other case — no `throughOffset`, no `io` event has an offset to compare
against, or no loaded event's offset qualifies — the mark falls back to the
record's own rebased `at`.

**Derived resizes (D9).** A `derived: true` `control`/`resize` Event
immediately precedes a record's mark whenever that record's geometry is
known, differs from the geometry last known, and no captured resize happened
since. "The geometry last known" starts at the manifest's `cols`/`rows` (when
both are `> 0`) and is updated, in timeline order, by every **captured**
resize Event and by every geometry-bearing record — so a capture always wins
over a reconstruction: one truth per resize, a reconstruction never doubles a
capture that already covers the same change.

Records across every `checkpoint` member in the bundle are processed in one
global timeline order — by `throughOffset` when present, else by rebased
`at` — since the D9 geometry-tracking state spans all of them, not just one
member's own records.

### Member encodings

| encoding        | member types               | wire shape                                                                                                         |
| --------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `jsonl`         | io, commands, facts, habcp | one JSON object per line; io rows are `IoEvent` (µs `at`), commands rows are `Command`; habcp rows are opaque here |
| `hts1`          | io                         | the binary journal framing (below); wall-ms `at`, rebased on read                                                  |
| `trace-index`   | frames                     | the frozen `TraceFrame` rows of `index.jsonl`, rasters beside it                                                   |
| `json`          | checkpoint                 | one JSON document — a record or an array of records, see [Checkpoint member](#checkpoint-member) above            |
| `zstd-seekable` | _reserved_                 | declared for large sealed io members; **not yet implemented** — a reader encountering it must fail loud, not skip  |

### The `hts1` io encoding

The binary journal framing written by always-on session recorders. Each frame:

```
"HTS1"            4 bytes  magic
version           1 byte   (= 1)
headerLen         u32 BE
payloadLen        u32 BE
header            headerLen bytes of JSON
payload           payloadLen bytes, raw
```

Header: `{ kind, offset, at, owner?, size?, state?, detail?,
retainedFromOffset? }` where `kind` ∈ `output | input | resize | lifecycle |
truncation` and `at` is **wall-clock milliseconds**. Caps: header ≤ 64 KiB,
payload ≤ 16 MiB. A truncated trailing frame is a **tear** — the reader stops
cleanly at the last complete frame. Bad magic or version is **corruption** —
the reader throws. These two error paths never collapse into one.

Mapping into the Recording (identical to the retired bridge, by construction):

- `output` → io event, `direction: "out"` (payload decoded UTF-8)
- `input` → io event, `direction: "in"` (`owner` is dropped — the io track is
  direction-tagged bytes, not peer-attributed; it survives in the source
  member)
- `resize` → a `commands` `resize` (a size change is intent; io has no size
  concept)
- `lifecycle`, `truncation` → no track; **tallied** and surfaced, never
  silently dropped
- `at` wall-ms values rebase to the µs clock against `originWallMs` (or the
  first event when absent); a stamp before the origin **throws** — a wall
  clock running backwards is corruption, not a thing to clamp

## The sealed encoding — `.ttyz`

A standard ZIP holding exactly the bundle's files, paths preserved:

- **ZIP64-capable**: entries or offsets beyond 32-bit limits write ZIP64
  records; small archives stay plain ZIP readable by any tool.
- **Per-member compression**: text members DEFLATE; already-compressed rasters
  (`.png`) are STORED.
- **Reproducible**: fixed timestamps, sorted entry order — the same bundle
  always seals to the same bytes.
- Sealing a live bundle first rotates the open tail into a sealed member;
  a `.ttyz` never contains a `tail`.

## Reading

```typescript
import { readRecording, readBundle } from "@termless/core"

const rec = readRecording("session.tty") // or "session.ttyz" — identical result
const { recording, manifest, skipped } = readBundle("session.tty")
```

- `readRecording(path)` — the encoding-blind door. Returns the `Recording`.
- `readBundle(path)` — the manifest-aware door for annotation, windowed, and
  player consumers: the `Recording`, the parsed manifest (facts/checkpoint
  members included), and the skip tally.
- Both accept both encodings; both produce identical Recordings from a bundle
  and its own seal.

## Writing

```typescript
import { writeRecording, packRecording, unpackRecording } from "@termless/core"

writeRecording("out.ttyz", recording) // Recording → sealed .ttyz
writeRecording("out.tty", recording) // Recording → at-rest .tty bundle
packRecording("live.tty", "out.ttyz") // seal a bundle (rotates the tail)
unpackRecording("in.ttyz", "work.tty") // unseal to a bundle
```

Live capture (a writer appending to a bundle's tail) is the session runtime's
job — termless defines the layout and reads it; the always-on writer conforms
to it.

## Session access — the live-read contract (spec; implementation follows)

This section names the vocabulary a **live** session reader conforms to,
unifying live and archived reads over one contract. It is the contract for
readers, written ahead of the reader itself — `termless/session` (reserved,
unbuilt) is where it lands. Nothing above this section changes; this adds a
read-time vocabulary layered on top of the bundle/member model already
specified.

**Frame element** — the unit of a session's ordered timeline:

```typescript
{ t_us: number, dir: "in" | "out" | "err" | "resize", data: Uint8Array }
```

This is termless's `IoEvent` widened for live reads, not a second Frame type:
`t_us` is the same integer-µs clock as `Recording`'s `Micros`, and `data` is
the same raw bytes. It widens today's on-disk `IoEvent.direction` (`"in"` |
`"out"` only, per [Member encodings](#member-encodings) above) by two tags:
`"err"` splits stderr from stdout where a session's transport distinguishes
them, and `"resize"` folds a size change into the same timeline element
instead of a separate `commands` row. A fold from this element back to the
`Terminal` read contract (see [TestTerminal](../../concepts/terminal) for the
contract's live-session wrapper) is how selectors/matchers query a live seat
and an archive with the same code.

**Cursor** (opaque) — a position marker a live-read call returns and accepts
back to resume from exactly that point. Unrelated to, and not to be confused
with, the terminal-caret `Cursor` type (`{ col, row, visible, style }`)
documented elsewhere in this package — same word, two different concepts, one
about a read position in a byte stream and the other about where the emulator
draws the caret. Callers must not construct or inspect a live-read `Cursor`;
it round-trips opaque.

**`SessionClose`** — the tombstone element a session's timeline ends with,
written exactly once, the moment the session ends. It is the only way a
reader learns "this stream will not grow further" — there is no other
end-of-session signal.

**`follow`** governs what a read does at the end of what is currently
written:

- `follow: false` halts there — at the tombstone if one is present, otherwise
  at the current end of the written stream. A snapshot read, not a wait.
- `follow: true` parks past the current end instead of returning: it does
  **not** deliver EOF on a live (not-yet-closed) stream. It resumes the
  instant more is appended, and only actually ends when the `SessionClose`
  tombstone arrives.

**Append-only segments** — the same append-only-tail discipline as the
bundle's `tail` member above ([`manifest.json`](#manifestjson)), generalized
to the live-read API: a segment is only ever grown, never rewritten in place,
so a reader mid-read never observes bytes it already read change under it.

**Rotation hands a new handle** — when a segment rotates (the same event as
"Sealing = rotate the tail into members" above, or an equivalent live
rotation), a reader following across the rotation is handed a **new** handle
rather than being left to continue silently on the old one. A reader that
does not ask for the new handle stops at the rotation boundary; it does not
silently keep reading stale state.

Refusals along this surface are permission-shaped (EACCES-like), not
exceptions of convenience — a reader denied access is told so the same way a
filesystem would, not with a bespoke error shape per caller.
