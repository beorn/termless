---
title: Asciicast v2 Format
description: Read, write, and convert asciicast v2 recordings for asciinema compatibility.
---

# Asciicast v2

Termless can read and write [asciicast v2](https://docs.asciinema.org/manual/asciicast/v2/) files (`.cast`) for compatibility with the asciinema ecosystem.

## What is Asciicast?

Asciicast v2 is a JSON-lines format for recording terminal sessions, created by the [asciinema](https://asciinema.org) project. Each `.cast` file has a header line (JSON object) followed by event lines (JSON arrays):

```
{"version": 2, "width": 80, "height": 24, "duration": 5.2}
[0.5, "o", "$ "]
[1.2, "o", "hello world\r\n"]
[3.0, "o", "$ "]
```

The format is widely supported by tools like [asciinema-player](https://github.com/asciinema/asciinema-player) for interactive web playback.

## CLI Usage

### Recording as Asciicast

```bash
# Record directly to asciicast format
$ termless record -o demo.cast my-app
```

### Playing Asciicast Files

```bash
# Play back an asciicast recording
$ termless play demo.cast

# Convert asciicast to GIF
$ termless play -o demo.gif demo.cast

# Convert asciicast to animated SVG
$ termless play -o demo.svg demo.cast
```

## Reading Asciicast Files

Parse `.cast` files into structured recordings:

```typescript
import { parseAsciicast, replayAsciicast } from "@termless/core"

// Parse a .cast file
const content = await Bun.file("demo.cast").text()
const recording = parseAsciicast(content)

console.log(recording.header.width)   // 80
console.log(recording.header.height)  // 24
console.log(recording.events.length)  // number of events
```

### Replay Through a Terminal

Feed an asciicast recording through any termless terminal backend:

```typescript
import { parseAsciicast, replayAsciicast } from "@termless/core"
import { createTerminal } from "@termless/core"
import { createXtermBackend } from "@termless/xtermjs"

const recording = parseAsciicast(content)
const term = createTerminal({
  backend: createXtermBackend(),
  cols: recording.header.width,
  rows: recording.header.height,
})

// Instant replay (no delays)
await replayAsciicast(recording, term, { speed: Infinity })

// Real-time replay
await replayAsciicast(recording, term)

// 2x speed
await replayAsciicast(recording, term, { speed: 2 })
```

## Writing Asciicast Files

### From a Termless Recording

Convert a termless `Recording` to asciicast format:

```typescript
import { toAsciicast } from "@termless/core"

const cast = toAsciicast(recording, { title: "My Demo" })
await Bun.write("demo.cast", cast)
```

### Structured Conversion

Convert between the two recording formats:

```typescript
import { recordingToAsciicast, asciicastToRecording } from "@termless/core"

// termless → asciicast
const asciicast = recordingToAsciicast(recording)

// asciicast → termless
const termlessRec = asciicastToRecording(asciicast)
```

### Streaming Writer

Build asciicast files incrementally with the streaming writer:

```typescript
import { createAsciicastWriter } from "@termless/core"

const writer = createAsciicastWriter({
  version: 2,
  width: 80,
  height: 24,
})

writer.writeOutput("$ ")
writer.writeInput("ls\n")
writer.writeOutput("file1  file2\n")
writer.writeOutput("$ ")
writer.writeMarker("end of demo")

const cast = writer.close() // JSON-lines string
await Bun.write("demo.cast", cast)
```

## Event Types

Asciicast v2 supports three event types:

| Type | Meaning | Example |
| ---- | ------- | ------- |
| `"o"` | Output (terminal data sent to screen) | `[1.5, "o", "hello\r\n"]` |
| `"i"` | Input (user keystrokes) | `[2.0, "i", "ls\n"]` |
| `"m"` | Marker (named position in recording) | `[3.0, "m", "step-2"]` |

During replay, only `"o"` events are fed to the terminal. Input events are recorded for reference but not replayed. Marker events are reported via the `onEvent` callback.

## Header Fields

| Field       | Type     | Required | Description                          |
| ----------- | -------- | -------- | ------------------------------------ |
| `version`   | `number` | Yes      | Must be `2`                          |
| `width`     | `number` | Yes      | Terminal columns                     |
| `height`    | `number` | Yes      | Terminal rows                        |
| `duration`  | `number` | No       | Total duration in seconds            |
| `timestamp` | `number` | No       | Unix timestamp of recording start    |
| `title`     | `string` | No       | Recording title                      |
| `env`       | `object` | No       | Environment variables (e.g., SHELL)  |
| `theme`     | `object` | No       | Color theme (fg, bg, palette)        |

## See Also

- [Recording & Playback](/guide/recording) -- CLI usage and recording modes
- [Tape Format Reference](/guide/tape-format) -- the `.tape` file format
- [asciinema documentation](https://docs.asciinema.org/manual/asciicast/v2/) -- upstream format specification
