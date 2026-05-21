---
title: Recording Formats
description: The three on-disk formats a Recording serializes to — .tape, .cast, and .rec.
---

# Recording Formats

A [Recording](../../concepts/recording) is one concept; these are the three
on-disk **formats** it serializes to and from. A format is an *encoding* — not a
domain object.

| Format                | Role                                          | Tracks it carries          |
| --------------------- | --------------------------------------------- | -------------------------- |
| [`.tape`](./tape)     | charm/VHS interop — a *compiler* input        | commands                   |
| [`.cast`](./asciicast) | asciinema interop — a symmetric *codec*       | io                         |
| [`.rec`](./rec)     | termless native — a single-file container          | commands + io + frames     |

Use `.tape` to author a session by hand or interop with VHS. Use `.cast` to
interop with the asciinema ecosystem. Use `.rec` for termless's own lossless,
all-tracks form.
