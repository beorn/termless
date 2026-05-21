---
title: .rec Format Reference
description: The native termless recording format — a single-file container carrying the commands, io, and frames tracks losslessly.
---

# `.rec` Format Reference

`.rec` is termless's **native** recording format — the canonical, full-fidelity
on-disk form of a [Recording](../../concepts/recording). Unlike [`.tape`](./tape)
(a lossy compiler input) and [`.cast`](./asciicast) (an io-only codec), `.rec`
carries **all three tracks** — commands, io, and frames — losslessly.

## Shape — a single-file container

A `.rec` is a **single file**: a standard ZIP container (like `.docx` or
`.epub`) holding the whole Recording as archive entries.

```
mysession.rec                    ← one file, a ZIP container holding:
  manifest.json                  — metadata, Renderer fingerprint, track index
  commands.jsonl                 — the commands source track   (omitted if absent)
  io.jsonl                       — the io source track         (omitted if absent)
  frames/index.jsonl + NNNNN.png — the frames projection        (omitted if absent)
```

A Recording is valid with any non-empty subset of tracks, so each track file is
written only when that track is present. `manifest.json` indexes which ones are.

The unpacked layout — a directory with the same entries — is an internal
working form. `packRecording` / `unpackRecording` convert between the file and
the directory; `writeRecording` / `readRecording` are the user-facing
single-file API.

## `manifest.json`

| Field              | Type                   | Meaning                                                    |
| ------------------ | ---------------------- | ---------------------------------------------------------- |
| `recVersion`       | `number`               | The `.rec` format version.                                 |
| `recordingVersion` | `1`                    | The Recording-model version.                               |
| `cols` / `rows`    | `number`               | Terminal size at recording start.                          |
| `durationMicros`   | `number`               | Total duration, integer microseconds.                      |
| `reproducible`     | `boolean`              | Whether the frames projection can be regenerated from io.  |
| `tracks`           | `{commands,io,frames}` | Which track files are present.                             |
| `fingerprint`      | `RendererFingerprint`  | The Renderer fingerprint the frames were rendered against. |

The presence of `manifest.json` is what distinguishes a full `.rec` container
from a bare legacy frame-trace directory.

## Superset of the frame-trace layout

The `frames/` subtree is **byte-identical** to a bare frame-trace directory —
`index.jsonl` plus `NNNNN.png` files. An existing frame-trace directory _is_ a
valid `.rec` `frames/` subtree: `readRecording` loads a bare frame-trace
directory (no `manifest.json`) as a frames-only Recording. That superset
relationship keeps existing visual-regression goldens valid.

### `frames/index.jsonl`

One JSON object per line, append-only and streaming-readable — a partial trace
from a crashed session stays parseable up to the last fully-flushed line:

```jsonc
{
  "seq": 1,
  "ts": 1747597815123,
  "iso": "2026-05-18T23:30:15.123Z",
  "hash": "xxh64:7f2a91b3c4d5e6f0",
  "duplicate_of": null,
  "bytes_in_since_last": 47,
  "buffer": { "cols": 140, "rows": 40, "cursor": { "row": 5, "col": 22 } },
  "duration_since_prev_ms": 22,
  "png": "00001.png"
}
{ "seq": 2, "ts": 1747597815145, "hash": "xxh64:7f2a91b3c4d5e6f0", "duplicate_of": 1, "png": null }
```

Identical buffer states (by xxHash64) are recorded with `duplicate_of` set and
the PNG skipped, to save disk.

## API

```typescript
import { writeRecording, readRecording, packRecording, unpackRecording, isRecPath } from "@termless/core"

// Write a Recording to a single .rec file
writeRecording("mysession.rec", recording, { pngSourceDir: "/tmp/my-trace" })

// Read a .rec file (or a bare legacy frame-trace directory) back
const rec = readRecording("mysession.rec")
```

### Directory working form

`unpackRecording` expands a `.rec` file into a directory bundle — the internal
working form — and `packRecording` zips a directory back into a single `.rec`
file. The single file is the canonical format; the directory is a convenience
for inspecting or editing the contents.

```typescript
unpackRecording("mysession.rec", "mysession-dir/")
packRecording("mysession-dir/", "mysession.rec")
```

## See Also

- [Recording](../../concepts/recording) -- the concept the format serializes.
- [Tracing Visual Bugs](../../guide/tracing-visual-bugs) -- the frames projection workflow.
- [.tape format](./tape) -- the VHS-compatible compiler format.
- [.cast format](./asciicast) -- the asciinema codec.
