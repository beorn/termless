---
title: Concepts Overview
description: The termless mental model — three domain objects (Backend, Terminal, Recording) and four verbs (record, view, play, compare).
---

# Concepts Overview

Termless has a small, deliberate vocabulary. Once you know it, every command,
API, and doc page falls into place. It is **three objects and four verbs** —
nothing else is a concept.

## The three objects

| Object        | Is                                                             | Side     |
| ------------- | -------------------------------------------------------------- | -------- |
| **Backend**   | a VT-emulator implementation (xterm.js, Ghostty, vt100, …)     | live     |
| **Terminal**  | a _live_ session — Backend + PTY + buffer + a readable API     | live     |
| **Recording** | a _captured_ session — its commands, I/O, and frames over time | captured |

Backend and Terminal are the **live** side: a program running right now, its
output flowing into an emulator you can inspect. Recording is the **captured**
side: that same session frozen onto a timeline you can replay, scrub, animate,
and diff.

That is the entire noun vocabulary. There is no `Recorder`, no `Viewer`, no
`Exporter` — those are verbs, not things.

## The four verbs

Everything you _do_ with a Recording is one of four verbs:

| Verb        | Does                                        | Direction                |
| ----------- | ------------------------------------------- | ------------------------ |
| **record**  | capture a Terminal into a Recording         | Terminal → Recording     |
| **view**    | present a Recording (scrub / animate / web) | Recording → presentation |
| **play**    | re-execute a Recording into a Terminal      | Recording → Terminal     |
| **compare** | diff one Recording across N backends        | Recording → diff         |

The same four verbs appear in the CLI (`termless record`, `termless view`,
`termless play`, `termless compare`), in the library API, and in the MCP server.
Learn them once.

## Renderer is a strategy, not an object

Turning a terminal buffer into pixels (PNG, SVG, canvas) is done by a
**Renderer** — but a Renderer is an internal _strategy_, not a fifth domain
object. Both `record` (frame capture) and `view` (per-frame display) use one
internally. You pick a Renderer the way you pick a backend; you never _learn_
it as a concept. Keeping it pluggable is what lets termless target the terminal
today and canvas/DOM surfaces later without moving the three objects.

## Where to go next

- [Backend](./backend) — the emulator implementations you run against.
- [Terminal](./terminal) — the live session and its readable surface.
- [Recording](./recording) — the captured session: its tracks and its formats.

For how-to material, see the [Recording Sessions](../guide/recording-sessions)
and [Tracing Visual Bugs](../guide/tracing-visual-bugs) guides.
