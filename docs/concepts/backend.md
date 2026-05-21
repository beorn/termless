---
title: Backend
description: A Backend is a VT-emulator implementation — the engine that parses escape sequences into a terminal buffer.
---

# Backend

A **Backend** is a VT-emulator implementation: the engine that takes a stream of
bytes (text and ANSI escape sequences) and maintains a terminal buffer — cells,
colors, cursor, scrollback, modes.

A Backend is the _live_ side's foundation. It does one job: parse bytes into
state. It does not own a PTY, does not spawn processes, does not render pixels —
a [Terminal](./terminal) wraps a Backend to add those.

## Why termless has many backends

Real terminal emulators disagree. xterm.js and Ghostty render the same emoji at
different widths; different emulators encode the same keypress differently, clamp
colors differently, and scroll differently. Termless ships **multiple backends**
so you can run the same test or recording against each one and find exactly where
they diverge.

| Backend     | Engine                           | Notes                                        |
| ----------- | -------------------------------- | -------------------------------------------- |
| `xtermjs`   | `@xterm/headless`                | Fast, portable — the default                 |
| `ghostty`   | ghostty-web (WASM)               | Truecolor + full glyph coverage; visual work |
| `vt100`     | pure TypeScript                  | Minimal VT100-era subset, zero native deps   |
| `vterm`     | pure TypeScript                  | Full standards coverage                      |
| `alacritty` | `alacritty_terminal` (napi-rs)   | Needs a Rust build                           |
| `wezterm`   | `wezterm-term` (napi-rs)         | Needs a Rust build                           |
| `peekaboo`  | OS automation against a real app | macOS only — pixel-perfect, slowest          |

See the [Backends guide](../guide/backends) for the full capability matrix and
the [Backend API](../api/backend) for the interface every backend implements.

## Choosing a backend

Two ways to pick one:

```typescript
// Factory function — explicit, synchronous
import { createXtermBackend } from "@termless/xtermjs"
import { createTerminal } from "@termless/core"
const term = createTerminal({ backend: createXtermBackend() })
```

```typescript
// By name — async, handles WASM/native init
import { backend } from "@termless/core"
const term = createTerminal({ backend: await backend("ghostty") })
```

Default to `xtermjs` for speed; reach for `ghostty` when visual fidelity matters
(screenshots, visual-bug evidence); reach for `peekaboo` only when you need a
real desktop terminal app in the loop.
