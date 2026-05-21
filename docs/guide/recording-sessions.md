---
title: Recording Sessions
description: Record terminal sessions, play them back, animate them as GIF/SVG/APNG, and compare across backends.
---

# Recording Sessions

A [Recording](../concepts/recording) is a captured terminal session. This guide
covers the everyday how-to: capture one with **record**, replay it with **play**,
animate it with **view**, and diff it across backends with **compare**.

For the underlying mental model — the three tracks, the formats — see the
[Recording concept page](../concepts/recording).

## Quick Start

```bash
# Record a command to a .tape file
$ termless record -o demo.tape ls -la

# Play it back and render a GIF
$ termless play -o demo.gif demo.tape

# Compare across backends — same recording, two emulators
$ termless compare demo.tape -b vterm,ghostty --compare side-by-side
```

## Record

`termless record` captures a [Terminal](../concepts/terminal) into a Recording.
Alias: `termless rec`.

### Interactive recording

Run a command (or your shell) and capture every keystroke into the commands
track:

```bash
# Record a command — exit the command to stop
$ termless record -o demo.tape ls -la

# Record a shell session — exit the shell to stop
$ termless record -o demo.tape

# Record a specific command
$ termless record -o demo.tape vim file.txt
```

Arrow keys, Ctrl sequences, and timing gaps are all captured. When the command
exits, the recording is saved.

### Scripted recording

Use inline tape commands with `-t` for reproducible, non-interactive recordings:

```bash
# Inline commands (newlines via \n)
$ termless rec -t 'Type "hello world"\nEnter\nSleep 1s\nScreenshot' bash

# With an output file
$ termless rec -t 'Type "ls -la"\nEnter\nScreenshot' -o listing.png bash
```

### Capture mode

For quick one-shot captures — send keys, take a screenshot — use `--keys` and
`--screenshot`:

```bash
# Run a TUI, navigate, capture
$ termless record --keys j,j,Enter --screenshot /tmp/app.svg bun km view /path

# Wait for specific text before pressing keys
$ termless record --wait-for "ready>" --keys Enter --screenshot /tmp/out.png my-app

# Just capture text output
$ termless record --text ls -la
```

### Compat capture (macOS)

`termless record --compat` records against the **peekaboo** backend — it spawns
your real desktop terminal app (Ghostty / kitty / iTerm / Terminal.app), runs the
command after `--`, screenshots the window, and cleans up. Pixel-perfect for that
terminal, with your font and theme.

```bash
$ termless record --compat -- bun km view ~/Vault
$ termless record --compat --terminal ghostty --cols 140 --rows 40 -o c.png -- bun km
```

Compat capture is macOS-only and needs a GUI session plus Screen Recording
permission. For routine visual iteration, plain `record` (the canvas renderer) is
faster and pops no window.

### Multiple outputs

Record once, write several formats:

```bash
$ termless record -o demo.tape -o demo.gif my-app
```

### Record options

| Option                   | Description                                    | Default     |
| ------------------------ | ---------------------------------------------- | ----------- |
| `-o, --output <path...>` | Output file(s), format detected from extension | stdout      |
| `-t, --tape <commands>`  | Inline tape commands (scripted mode)           | --          |
| `-b, --backend <name>`   | Backend for scripted mode                      | vterm       |
| `--cols <n>`             | Terminal columns                               | `80`        |
| `--rows <n>`             | Terminal rows                                  | `24`        |
| `--timeout <ms>`         | Wait timeout in ms                             | `5000`      |
| `--keys <keys>`          | Comma-separated key names to press             | --          |
| `--screenshot <path>`    | Save screenshot (SVG or PNG by extension)      | --          |
| `--wait-for <text>`      | Wait for text before pressing keys             | `content`   |
| `--text`                 | Print terminal text to stdout                  | off         |
| `--compat`               | Compat capture in a real desktop terminal app  | off         |
| `--terminal <name>`      | Compat terminal app (with `--compat`)          | auto-detect |

## Play

`termless play` re-executes a Recording into a Terminal. It accepts any
recording format:

```bash
# Play a recording (prints terminal text)
$ termless play demo.tape
$ termless play demo.cast

# Generate a screenshot
$ termless play -o screenshot.png demo.tape

# Generate an animated GIF
$ termless play -o demo.gif demo.tape

# Generate an animated SVG (CSS keyframes, no dependencies)
$ termless play -o demo.svg demo.tape

# Generate an APNG
$ termless play -o demo.apng demo.tape
```

### Play options

| Option                 | Description                                                    | Default |
| ---------------------- | -------------------------------------------------------------- | ------- |
| `-o, --output <path>`  | Output file, format detected from extension                    | --      |
| `-b, --backend <name>` | Backend(s), comma-separated; use `all` for every ready backend | vterm   |
| `--compare <mode>`     | Comparison mode (delegates to `compare`)                       | --      |
| `--cols <n>`           | Override terminal columns                                      | --      |
| `--rows <n>`           | Override terminal rows                                         | --      |

## View

`termless view` presents a recording — by default it writes a self-contained,
scrubbable `viewer.html` next to the recording; with `--format gif` it animates
the recording's frames into a GIF. See
[Tracing Visual Bugs](./tracing-visual-bugs) for the scrubbable viewer.

```bash
# Scrub a recording in the browser
$ termless view ./mysession.rec

# Animate a recording to a GIF
$ termless view ./trace --format gif -o demo.gif
```

To embed a recording in browser docs, use the
[web player](./web-player) (`@termless/web-player`).

## Compare

`termless compare` plays one recording across two or more backends and diffs the
results — "does my TUI look the same in every terminal?"

```bash
# Side-by-side comparison
$ termless compare demo.tape -b vterm,ghostty --compare side-by-side -o comparison.svg

# Separate screenshots per backend
$ termless compare demo.tape -b vterm,ghostty,xtermjs --compare separate -o ./out/

# Every installed, ready backend
$ termless compare demo.tape -b all --compare grid -o all-backends.svg

# Diff mode — pixel-diff overlays against the baseline backend
$ termless compare demo.tape -b vterm,ghostty --compare diff -o diff.svg
```

`compare` is also reachable as `play --compare <mode>` — a thin alias.

### Comparison modes

| Mode           | Description                                                          |
| -------------- | -------------------------------------------------------------------- |
| `separate`     | Individual screenshots per backend                                   |
| `side-by-side` | Two backends side by side in one image                               |
| `grid`         | All backends in a grid layout                                        |
| `diff`         | Screenshots plus pixel-diff overlays against the first backend       |

## Output Formats

Recordings render to multiple output formats — no Chromium, no ffmpeg:

| Format       | Extension | Type           | Dependencies           |
| ------------ | --------- | -------------- | ---------------------- |
| PNG          | `.png`    | Single frame   | `@resvg/resvg-js`      |
| SVG          | `.svg`    | Single frame   | None (built-in)        |
| Animated SVG | `.svg`    | Multi-frame    | None (CSS keyframes)   |
| GIF          | `.gif`    | Multi-frame    | `gifenc` (pure JS)     |
| APNG         | `.apng`   | Multi-frame    | `upng-js` (pure JS)    |
| Web player   | browser   | Interactive    | `@termless/web-player` |

The three on-disk recording **formats** — `.tape`, `.cast`, `.rec` — are
documented under [Recording Formats](../reference/formats/).

## Programmatic API

Record and replay are also library functions:

```typescript
import { startRecording, replayRecording, createTerminal } from "@termless/core"
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
await replayRecording(term2, recording, { realtime: true }) // original timing
```

## See Also

- [Recording](../concepts/recording) -- the concept and its three tracks.
- [Tracing Visual Bugs](./tracing-visual-bugs) -- the frames projection + scrubbable viewer.
- [Recording Formats](../reference/formats/) -- the `.tape`, `.cast`, and `.rec` specs.
- [Web Player](./web-player) -- embed a recording in browser docs.
- [Screenshots](./screenshots) -- single-frame SVG and PNG capture.
- [Multi-Backend Testing](./multi-backend) -- backend comparison in Vitest.
