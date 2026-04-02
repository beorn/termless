---
title: Recording & Playback
description: Record terminal sessions, play back tape files, and generate animated output as GIF, animated SVG, APNG, or asciicast.
---

# Recording & Playback

Record terminal sessions as `.tape` files and play them back as animated GIFs, SVGs, APNGs, or asciicast recordings. Test your TUI against multiple backends with a single tape file.

## Quick Start

```bash
# Record a command to a tape file
$ termless record -o demo.tape ls -la

# Play it back and generate a GIF
$ termless play -o demo.gif demo.tape

# Cross-terminal comparison — does it look the same in vterm and Ghostty?
$ termless play -b vterm,ghostty --compare side-by-side demo.tape
```

## Recording

### Interactive Recording

Run a command (or your shell) and record keystrokes as `.tape` commands:

```bash
# Record a command — exit the command to stop recording
$ termless record -o demo.tape ls -la

# Record a shell session — exit the shell to stop
$ termless record -o demo.tape

# Record with a specific command
$ termless record -o demo.tape vim file.txt
```

The recorder captures every keystroke (including arrow keys, Ctrl sequences, and timing gaps) and converts them to `.tape` format. When the command exits, the tape is saved.

### Scripted Recording

Use inline tape commands with `-t` for reproducible, non-interactive recordings:

```bash
# Inline tape commands (newlines via \n)
$ termless rec -t 'Type "hello world"\nEnter\nSleep 1s\nScreenshot' bash

# With a specific output file
$ termless rec -t 'Type "ls -la"\nEnter\nScreenshot' -o listing.png bash
```

### Capture Mode

For quick one-shot captures (send keys, take a screenshot), use `--keys` and `--screenshot`:

```bash
# Run a TUI, navigate, capture
$ termless record --keys j,j,Enter --screenshot /tmp/app.svg bun km view /path

# Wait for specific text before pressing keys
$ termless record --wait-for "ready>" --keys Enter --screenshot /tmp/out.png my-app

# Just capture text output
$ termless record --text ls -la
```

### Multiple Outputs

Record once, output in multiple formats:

```bash
# Tape file + GIF in one pass
$ termless record -o demo.tape -o demo.gif my-app
```

### Record Options

| Option                   | Description                                    | Default   |
| ------------------------ | ---------------------------------------------- | --------- |
| `-o, --output <path...>` | Output file(s), format detected from extension | stdout    |
| `-t, --tape <commands>`  | Inline tape commands (scripted mode)           | --        |
| `-b, --backend <name>`   | Backend for scripted mode                      | vterm     |
| `--cols <n>`             | Terminal columns                               | `80`      |
| `--rows <n>`             | Terminal rows                                  | `24`      |
| `--timeout <ms>`         | Wait timeout in ms                             | `5000`    |
| `--keys <keys>`          | Comma-separated key names to press             | --        |
| `--screenshot <path>`    | Save screenshot (SVG or PNG by extension)      | --        |
| `--wait-for <text>`      | Wait for text before pressing keys             | `content` |
| `--text`                 | Print terminal text to stdout                  | off       |

## Playback

Play back `.tape` or `.cast` files against any backend:

```bash
# Play a tape file (prints terminal text)
$ termless play demo.tape

# Generate a screenshot
$ termless play -o screenshot.png demo.tape

# Generate an animated GIF
$ termless play -o demo.gif demo.tape

# Generate an animated SVG (CSS keyframes, no dependencies)
$ termless play -o demo.svg demo.tape

# Generate an APNG
$ termless play -o demo.apng demo.tape

# Play an asciicast file
$ termless play demo.cast
```

### Play Options

| Option                 | Description                                 | Default |
| ---------------------- | ------------------------------------------- | ------- |
| `-o, --output <path>`  | Output file, format detected from extension | --      |
| `-b, --backend <name>` | Backend(s), comma-separated                 | vterm   |
| `--compare <mode>`     | Comparison mode (requires 2+ backends)      | --      |
| `--cols <n>`           | Override terminal columns                   | --      |
| `--rows <n>`           | Override terminal rows                      | --      |

## Output Formats

Termless produces output in multiple formats, all without external dependencies like Chromium or ffmpeg:

| Format       | Extension | Type           | Dependencies         |
| ------------ | --------- | -------------- | -------------------- |
| PNG          | `.png`    | Single frame   | `@resvg/resvg-js`    |
| SVG          | `.svg`    | Single frame   | None (built-in)      |
| Animated SVG | `.svg`    | Multi-frame    | None (CSS keyframes) |
| GIF          | `.gif`    | Multi-frame    | `gifenc` (pure JS)   |
| APNG         | `.apng`   | Multi-frame    | `upng-js` (pure JS)  |
| asciicast v2 | `.cast`   | Recording data | None (JSON-lines)    |
| Tape         | `.tape`   | Recording data | None (text)          |

## Cross-Terminal Comparison

Play a tape file against multiple backends simultaneously and compare the results. This answers the question: "Does my TUI look the same in every terminal?"

```bash
# Side-by-side comparison (composed SVG)
$ termless play -b vterm,ghostty --compare side-by-side -o comparison.svg demo.tape

# Separate screenshots per backend
$ termless play -b vterm,ghostty,xtermjs --compare separate -o ./out/ demo.tape

# Grid layout
$ termless play -b vterm,ghostty,alacritty --compare grid -o grid.svg demo.tape

# Diff mode — highlights differences between backends
$ termless play -b vterm,ghostty --compare diff -o diff.svg demo.tape
```

### Comparison Modes

| Mode           | Description                                   |
| -------------- | --------------------------------------------- |
| `separate`     | Individual screenshots per backend            |
| `side-by-side` | Two backends side by side in one image        |
| `grid`         | All backends in a grid layout                 |
| `diff`         | Highlights cells that differ between backends |

## Programmatic API

Recording and replay are also available as library functions:

```typescript
import { startRecording, replayRecording } from "@termless/core"
import { createTerminal } from "@termless/core"
import { createXtermBackend } from "@termless/xtermjs"

// Record a session
const term = createTerminal({ backend: createXtermBackend(), cols: 80, rows: 24 })
const handle = startRecording(term)
handle.recordOutput("$ ")
handle.recordInput("ls\n")
handle.recordOutput("file1  file2\n$ ")
const recording = handle.stop() // JSON-serializable

// Replay into another terminal
const term2 = createTerminal({ backend: createXtermBackend(), cols: 80, rows: 24 })
await replayRecording(term2, recording)
await replayRecording(term2, recording, { realtime: true }) // with original timing
```

### Asciicast Conversion

Convert between termless recordings and asciicast v2 format:

```typescript
import { recordingToAsciicast, asciicastToRecording } from "@termless/core"

// termless recording → asciicast
const cast = recordingToAsciicast(recording, { title: "My Demo" })

// asciicast → termless recording
const rec = asciicastToRecording(cast)
```

## See Also

- [Tape Format Reference](/guide/tape-format) -- full `.tape` command reference
- [Asciicast v2](/guide/asciicast) -- asciicast format details and API
- [Screenshots](/guide/screenshots) -- SVG and PNG screenshot generation
- [Multi-Backend Testing](/guide/multi-backend) -- testing against multiple backends in Vitest
