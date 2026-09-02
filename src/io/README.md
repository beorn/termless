# @termless/core/io — the unterm primitives

A few shared types every terminal product sits on, and nothing sits under: **Session** · **Event** · **Emulator** · **Recording**, plus `pipe` and the Web Streams bridges. This module depends on nothing.

```ts
import { pipe, type Session, type Emulator } from "@termless/core/io"

// spawn, read the screen (headless agent)
const session: Session = spawn({ cmd: ["claude"], cols: 120, rows: 40 })
const emu: Emulator = vterm(session.size)
pipe(session.events(), emu)
session.input.write("run the tests\r")
emu.getText()
```

## The four primitives

| primitive   | one line                                                                                                                                                | file           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `Session`   | a live terminal you talk to — spawned, attached, wrapped, or replayed; `events()` is THE primitive, `output`/`input`/`control` are filtered views of it | `session.ts`   |
| `Event`     | everything that happens: `{ at, type: "output" \| "input" \| "control" \| "mark" \| "exit", … }` — full words in code, letters only in codecs           | `event.ts`     |
| `Emulator`  | eats Events and shows you the picture: `apply(e)`, `getText()`, `getCell()`, cursor, modes, size                                                        | `emulator.ts`  |
| `Recording` | a header plus the Events, saved; one vocabulary, several containers                                                                                     | `recording.ts` |

`Source = AsyncIterable<Event>` and `Sink = { apply(e) }` are aliases, not concepts. `pipe(source, ...sinks)` awaits each `apply` — backpressure is the pull side doing its job. `toReadable()` / `fromReadable()` bridge to Web Streams for fan-out and platform interop (`pipe.ts`). The picture types (`Cell`, `Color`, `Cursor`, …) and the `Micros` timebase live here too, because `Emulator.getCell` returns a `Cell` (`picture.ts`, `time.ts`).

## Transforms

Pure functions over a `Recording`, in `transforms.ts`. `trim(recording, { from?, to? })` keeps an inclusive window and shifts it to start at 0. `retime(recording, { speed?, maxGap? })` rescales the gaps between events. `filter(recording, keep)` keeps only the events a predicate accepts — pair it with `byType(...types)` for a predicate checked against the `Event` discriminant. None mutate their input, and each returns a `Recording`, so they compose:

```ts
import { trim, retime, filter, byType, micros } from "@termless/core/io"

// keep the middle third, play it back twice as fast, then just the marks
const clip = trim(recording, { from: micros(30_000_000), to: micros(90_000_000) })
const sped = retime(clip, { speed: 2, maxGap: micros(2_000_000) })
const highlights = filter(sped, byType("mark"))
```

## The law

Everything points at io; io points at nothing. Emulators are injected by interface, with vterm the default in exactly one place per consumer. This module is reached as the `./io` subpath, not the root barrel: the barrel still exports an older `Recording`, and a bare `Event` there would shadow the DOM global — both resolve when the Recording models converge (unterm phase A3).

## Migration state

Phase A1 of unterm Track A: the primitives are minted here and the old names (`TerminalBackend`, the `Terminal` read API, the pty half of `SpawnOptions`, `IoEvent`) are `@deprecated` aliases or adapters naming their replacement. They are deleted in phase A4 — every marker says so. Consumers move in A2.

## Part of unterm

Anchor: the unterm design document (kept with the hallohuman workspace, not in this repository). Siblings today: `@termless/vterm` (production emulator), `@termless/xtermjs` (the differential reference); the physical split into `@unterm/io`, `@unterm/recording`, viterm and termtv is Track B, against this frozen surface.
