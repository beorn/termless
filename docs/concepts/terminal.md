---
title: Terminal
description: A Terminal is a live session — a Backend plus an optional PTY, a buffer, and a readable, queryable API.
---

# Terminal

A **Terminal** is a _live_ terminal session. It wraps a [Backend](./backend) and
adds everything you need to run a real program and inspect what it draws:

- an optional **PTY** — spawn a process and connect it to the emulator;
- the **buffer** — cells, colors, cursor, scrollback, modes;
- a **readable surface** — query the screen as structured data, not strings;
- **input** — press keys, type text, click and drag;
- **region selectors** + **matchers** — the testing surface.

A Terminal is the live counterpart of a [Recording](./recording): a Terminal is
a session happening _now_; a Recording is a session captured _over time_.

## Creating a Terminal

```typescript
import { createTerminal } from "@termless/core"
import { createXtermBackend } from "@termless/xtermjs"

const term = createTerminal({ backend: createXtermBackend(), cols: 80, rows: 24 })
await term.spawn(["bash", "-lc", "ls -la"])
```

## The readable surface

A Terminal exposes its buffer as queryable values, never as a flat string:

- **`Buffer`** / **`Cell`** — the grid and a single cell (text, fg, bg, style flags).
- **`RegionView`** — a lazy view over part of the screen that recomputes on access.
- **`RowView`** — a single row with cell-level access.

These are _value types within_ a Terminal — not separate domain objects. You
read them; you don't construct a session out of them.

## Region selectors + matchers

Termless's headline testing API is a **query-and-assert** pair over a Terminal:
pick **where** with a region selector, assert **what** with a matcher.

```typescript
expect(term.screen).toContainText("ready")
expect(term.cell(0, 8)).toHaveFg("#00ff00")
expect(term).toHaveCursorAt(14, 2)
```

Region selectors — `term.screen`, `term.scrollback`, `term.buffer`,
`term.viewport`, `term.row(n)`, `term.cell(r, c)`, `term.range(...)` — are an
_API over_ a Terminal, not a noun of their own.

See the [Terminal API](../api/terminal) for the full method list, the
[Writing Tests guide](../guide/writing-tests) for the testing workflow, and the
[Matcher Reference](../matchers/) for every matcher.
