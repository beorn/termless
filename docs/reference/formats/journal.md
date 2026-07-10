---
title: Journal Replay Reference
description: Replay a recorded terminal-session journal through any Termless terminal or backend for deterministic recording, conformance, and visual fixtures.
---

# Journal Replay Reference

A **journal** is a recorded stream of terminal-session events — output bytes,
input keystrokes, resizes, lifecycle transitions, and history truncations —
replayed through any Termless [Terminal](../../concepts/terminal) or
[Backend](../../concepts/backend) to reproduce a session deterministically for
recording, conformance, and visual fixtures.

Unlike the three on-disk [formats](./) (`.tape`, `.cast`, `.rec`), the journal
surface is a **replay input shape**, not a serializer. Its types are
deliberately **structural** — Termless declares no dependency on whatever
produced the journal. External adapters convert a real session log into this
shape; Termless stays standalone.

## Shape

A journal fixture is JSON. Byte payloads ride as base64 (`bytesB64`) so the
whole fixture stays JSON-clean:

```typescript
interface JournalReplayInput {
  size?: { cols: number; rows: number } // initial size; resize events override
  events: JournalReplayEvent[]
}

interface JournalReplayEvent {
  kind: "output" | "input" | "resize" | "lifecycle" | "truncation"
  offset: number
  at: number
  bytesB64?: string // base64 raw bytes — for output/input events
  size?: { cols: number; rows: number } // for resize events
  state?: string // for lifecycle events (e.g. "awake", "exited")
  retainedFromOffset?: number // for truncation markers
}

interface JournalReplayResult {
  applied: number // count of events that mutated terminal state (output + resize)
  truncations: number[] // offsets where retained history begins (older is gone)
  lifecycle: string[] // lifecycle states seen, in order
}
```

## Which events mutate, which are surfaced

Only **`output`** and **`resize`** events mutate the terminal — they feed bytes
and apply a new size. Everything else is **surfaced in the result for
assertions** rather than applied:

| Kind         | Effect                                                                        |
| ------------ | ----------------------------------------------------------------------------- |
| `output`     | Feeds `bytesB64` to the target; counted in `applied`.                         |
| `resize`     | Applies `size` to the target; counted in `applied`.                           |
| `input`      | **Not** fed — these are bytes a client *sent*; replaying them as output would corrupt the screen. Present for assertions only. |
| `lifecycle`  | Appends `state` to `result.lifecycle`.                                         |
| `truncation` | Appends `retainedFromOffset` to `result.truncations` (history older than this offset is gone). |

## Replaying

`parseJournalFixture(content)` parses a JSON journal (throws if `events` is not
an array). `replayJournal(input, target)` drives it through any
`JournalReplayTarget` — the structural minimum `{ feed, resize }`. A
`TestTerminal`, a `TerminalBackend`, or a thin wrapper over a guest handle all
satisfy it:

```typescript
import { createTerminal, parseJournalFixture, replayJournal } from "@termless/core"
import { createXtermBackend } from "@termless/xtermjs"

const input = parseJournalFixture(await Bun.file("session.journal.json").text())

const term = createTerminal({
  backend: createXtermBackend(),
  cols: input.size?.cols ?? 80,
  rows: input.size?.rows ?? 24,
})

// TestTerminal already satisfies JournalReplayTarget (feed + resize).
const result = replayJournal(input, term)

console.log(result.applied) // output + resize events applied
console.log(result.lifecycle) // e.g. ["awake", "exited"]
console.log(result.truncations) // offsets where retained history begins
```

To target a lower-level guest handle, wrap it in the structural shape:

```typescript
import type { JournalReplayTarget } from "@termless/core"

const target: JournalReplayTarget = {
  feed: (bytes) => guest.feedAnsi(bytes),
  resize: (cols, rows) => guest.size.requestResize(cols, rows),
}
```

## See Also

- [Conformance Corpus](../../advanced/conformance-corpus) — journals feed the
  session-differential conformance runner.
- [.cast format](./asciicast) — the sibling replay surface for asciinema
  recordings.
- [Recording](../../concepts/recording) — the in-memory model the on-disk
  formats serialize.
