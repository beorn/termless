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
  "ttyVersion": 1,           // format version of this manifest schema
  "recordingVersion": 1,     // Recording model version
  "cols": 80,                // terminal columns at recording start
  "rows": 24,                // terminal rows at recording start
  "durationMicros": 5200000, // total duration, integer µs
  "reproducible": true,      // frames projection regenerable from io?
  "originWallMs": 1754620000000, // OPTIONAL: wall-clock ms of µs-origin 0
  "fingerprint": { /* RendererFingerprint */ }, // OPTIONAL, frames-bearing only

  // Sealed members. Every listed member is complete and immutable.
  "members": [
    { "path": "io.jsonl", "type": "io", "encoding": "jsonl" },
    { "path": "io/00000000000000000000-00000000000000012345.hts",
      "type": "io", "encoding": "hts1",
      "micros": [0, 3100000] },      // OPTIONAL: time range covered, µs
    { "path": "facts/00000000000000000000-00000000000000000456.jsonl",
      "type": "facts", "encoding": "jsonl" },
    { "path": "commands.jsonl", "type": "commands", "encoding": "jsonl" },
    { "path": "frames/index.jsonl", "type": "frames", "encoding": "trace-index" },
    { "path": "checkpoints/00000000000000012345.json",
      "type": "checkpoint", "encoding": "json" }
  ],

  // The ONE open segment of a LIVE bundle. Absent in a sealed bundle —
  // sealing rotates the tail into `members`. Tail-follow readers poll this
  // file; its bytes are append-only between manifest rewrites.
  "tail": { "path": "io/current", "type": "io", "encoding": "hts1" }
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

| type         | carries                                   | → Recording        |
| ------------ | ----------------------------------------- | ------------------ |
| `io`         | direction-tagged raw byte events          | `io` track         |
| `commands`   | timed intent (keys, resize, sleeps)       | `commands` track   |
| `frames`     | rendered frame index + rasters            | `frames` projection |
| `facts`      | session fact events (annotation source)   | *not loaded* — exposed to annotation/windowed readers |
| `checkpoint` | serialized terminal state at an offset    | *not loaded* — seek keyframes for players and reattach |

`facts` and `checkpoint` members are first-class bundle members that the
Recording model deliberately does not carry: facts are the annotation source
(verdicts and extracted facts are sidecars, never mutations of the artifact),
and checkpoints are derived seek keyframes (streams are stored; snapshots are
derived). `readBundle` surfaces them; `readRecording` returns the Recording
and **tallies** what it did not load — never a silent skip.

### Member encodings

| encoding      | member types     | wire shape                                        |
| ------------- | ---------------- | ------------------------------------------------- |
| `jsonl`       | io, commands, facts | one JSON object per line; io rows are `IoEvent` (µs `at`), commands rows are `Command` |
| `hts1`        | io               | the binary journal framing (below); wall-ms `at`, rebased on read |
| `trace-index` | frames           | the frozen `TraceFrame` rows of `index.jsonl`, rasters beside it |
| `json`        | checkpoint       | one JSON document                                 |
| `zstd-seekable` | *reserved*     | declared for large sealed io members; **not yet implemented** — a reader encountering it must fail loud, not skip |

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
writeRecording("out.tty", recording)  // Recording → at-rest .tty bundle
packRecording("live.tty", "out.ttyz") // seal a bundle (rotates the tail)
unpackRecording("in.ttyz", "work.tty") // unseal to a bundle
```

Live capture (a writer appending to a bundle's tail) is the session runtime's
job — termless defines the layout and reads it; the always-on writer conforms
to it.
