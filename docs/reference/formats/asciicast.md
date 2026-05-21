---
title: .cast Format Reference
description: Read, write, and convert asciicast v2 recordings for asciinema compatibility.
---

# `.cast` Format Reference

`.cast` is one of the three on-disk [formats](./) a [Recording](../../concepts/recording)
serializes to. It is the [asciicast v2](https://docs.asciinema.org/manual/asciicast/v2/)
format from the [asciinema](https://asciinema.org) project, used for interop with
the asciinema ecosystem.

Unlike [`.tape`](./tape) (a compiler input), `.cast` is a **symmetric codec**: it
decodes losslessly into a Recording's **io** track, and encodes the io track back
out without loss.

## What is asciicast?

asciicast v2 is a JSON-lines format. Each `.cast` file has a header line (a JSON
object) followed by event lines (JSON arrays):

```
{"version": 2, "width": 80, "height": 24, "duration": 5.2}
[0.5, "o", "$ "]
[1.2, "o", "hello world\r\n"]
[3.0, "o", "$ "]
```

It is widely supported — for example by
[asciinema-player](https://github.com/asciinema/asciinema-player) for interactive
web playback.

## CLI Usage

```bash
# Record directly to .cast
$ termless record -o demo.cast my-app

# Play back a .cast recording
$ termless play demo.cast

# Convert .cast to a GIF
$ termless play -o demo.gif demo.cast

# Convert .cast to an animated SVG
$ termless play -o demo.svg demo.cast
```

## Reading `.cast` Files

Parse `.cast` files into a structured Recording:

```typescript
import { parseAsciicast, replayAsciicast } from "@termless/core"

const content = await Bun.file("demo.cast").text()
const recording = parseAsciicast(content)

console.log(recording.header.width) // 80
console.log(recording.header.height) // 24
console.log(recording.events.length) // number of events
```

### Replay Through a Terminal

Feed a `.cast` recording through any backend:

```typescript
import { parseAsciicast, replayAsciicast, createTerminal } from "@termless/core"
import { createXtermBackend } from "@termless/xtermjs"

const recording = parseAsciicast(content)
const term = createTerminal({
  backend: createXtermBackend(),
  cols: recording.header.width,
  rows: recording.header.height,
})

await replayAsciicast(recording, term, { speed: Infinity }) // instant
await replayAsciicast(recording, term) // real-time
await replayAsciicast(recording, term, { speed: 2 }) // 2x
```

## Writing `.cast` Files

Convert a Recording to `.cast`:

```typescript
import { toAsciicast } from "@termless/core"

const cast = toAsciicast(recording, { title: "My Demo" })
await Bun.write("demo.cast", cast)
```

### Codec Conversion

`.cast` decodes to the io track and encodes back from it:

```typescript
import { recordingToAsciicast, asciicastToRecording } from "@termless/core"

const asciicast = recordingToAsciicast(recording) // Recording → .cast
const rec = asciicastToRecording(asciicast) // .cast → Recording
```

### Streaming Writer

Build `.cast` files incrementally:

```typescript
import { createAsciicastWriter } from "@termless/core"

const writer = createAsciicastWriter({ version: 2, width: 80, height: 24 })

writer.writeOutput("$ ")
writer.writeInput("ls\n")
writer.writeOutput("file1  file2\n")
writer.writeMarker("end of demo")

const cast = writer.close() // JSON-lines string
await Bun.write("demo.cast", cast)
```

## Event Types

asciicast v2 supports three event types. These map directly to the io track's
direction tags:

| Type  | Meaning                               | Example                   |
| ----- | ------------------------------------- | ------------------------- |
| `"o"` | Output (terminal data sent to screen) | `[1.5, "o", "hello\r\n"]` |
| `"i"` | Input (user keystrokes)               | `[2.0, "i", "ls\n"]`      |
| `"m"` | Marker (named position)               | `[3.0, "m", "step-2"]`    |

During replay, only `"o"` events are fed to the terminal. Input events are
recorded for reference; markers are reported via the `onEvent` callback.

## Header Fields

| Field       | Type     | Required | Description                         |
| ----------- | -------- | -------- | ----------------------------------- |
| `version`   | `number` | Yes      | Must be `2`                         |
| `width`     | `number` | Yes      | Terminal columns                    |
| `height`    | `number` | Yes      | Terminal rows                       |
| `duration`  | `number` | No       | Total duration in seconds           |
| `timestamp` | `number` | No       | Unix timestamp of recording start   |
| `title`     | `string` | No       | Recording title                     |
| `env`       | `object` | No       | Environment variables (e.g., SHELL) |
| `theme`     | `object` | No       | Color theme (fg, bg, palette)       |

## See Also

- [Recording Sessions](../../guide/recording-sessions) -- recording and playback how-to.
- [.tape format](./tape) -- the VHS-compatible compiler format.
- [.trec format](./trec) -- termless's native, all-tracks format.
- [asciinema documentation](https://docs.asciinema.org/manual/asciicast/v2/) -- upstream spec.
