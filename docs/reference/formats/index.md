---
title: Recording Formats
description: The on-disk formats a Recording serializes to — .tape, .cast, and .tty/.ttyz.
---

# Recording Formats

A [Recording](../../concepts/recording) is one concept; these are the three
on-disk **formats** it serializes to and from. A format is an _encoding_ — not a
domain object.

| Format                 | Role                                      | Tracks it carries      |
| ---------------------- | ----------------------------------------- | ---------------------- |
| [`.tape`](./tape)      | charm/VHS interop — a _compiler_ input    | commands               |
| [`.cast`](./asciicast) | asciinema interop — a symmetric _codec_   | io                     |
| [`.tty`/`.ttyz`](./tty) | termless native — live bundle dir ⇄ sealed archive | commands + io + frames + facts + checkpoints |

Use `.tape` to author a session by hand or interop with VHS. Use `.cast` to
interop with the asciinema ecosystem. Use `.tty`/`.ttyz` for termless's own lossless,
all-tracks form.
