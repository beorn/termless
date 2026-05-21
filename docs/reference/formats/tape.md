---
title: .tape Format Reference
description: Complete reference for the .tape recording format -- commands, settings, duration syntax, and examples.
---

# `.tape` Format Reference

`.tape` is one of the three on-disk [formats](./) a [Recording](../../concepts/recording)
serializes to. It is a line-based DSL for _scripting_ a terminal session, compatible
with [VHS](https://github.com/charmbracelet/vhs) by Charmbracelet — termless adds
headless execution and multi-backend playback.

`.tape` is a **compiler input**, not a symmetric codec: a `.tape` file _compiles_
into a Recording's **commands** track (`Type "hi"` expands into key events with
timing; `Sleep` is a player directive). Going the other way — Recording → `.tape` —
is best-effort. For lossless storage of all tracks, use [`.rec`](./rec).

## Overview

A `.tape` file is a sequence of commands, one per line. Blank lines and comments
(lines starting with `#`) are ignored.

```tape
# This is a comment
Set FontSize 14
Set Width 1200
Set Height 600

Type "echo hello world"
Enter
Sleep 1s
Screenshot
```

## Commands

### Type

Type text characters into the terminal. Text must be quoted.

```tape
Type "hello world"
Type "echo 'foo bar'"
```

#### Typing Speed

Control how fast characters are typed with `Type@<speed>`:

```tape
Type@50ms "slow typing"
Type@10ms "fast typing"
Type@200ms "very slow, dramatic typing"
```

### Key Commands

Press special keys. These are case-insensitive.

```tape
Enter
Tab
Space
Backspace
Delete
Escape
```

#### Arrow Keys

```tape
Up
Down
Left
Right
```

#### Navigation Keys

```tape
Home
End
PageUp
PageDown
```

#### Repeat Count

Press a key multiple times:

```tape
Down 5
Tab 3
```

### Modifier Keys

Combine with `Ctrl+` or `Alt+`:

```tape
Ctrl+c
Ctrl+z
Ctrl+a
Alt+x
Alt+f
```

### Sleep

Pause execution for a duration:

```tape
Sleep 2s
Sleep 500ms
Sleep 0.5s
```

### Screenshot

Capture a screenshot of the current terminal state. `Screenshot` is a _render
directive_ — it tells the player to rasterize the current buffer:

```tape
# Screenshot with auto-generated path
Screenshot

# Screenshot to a specific file
Screenshot /tmp/demo.png
```

### Hide / Show

Control whether terminal output is visible during playback. Useful for skipping
setup steps in animations:

```tape
Hide
Type "npm install"
Enter
Sleep 5s
Show
Type "npm start"
Enter
Screenshot
```

### Source

Include commands from another tape file:

```tape
Source setup.tape
Type "my-command"
Enter
Screenshot
```

### Require

Assert that a program is available before running the tape:

```tape
Require node
Require bun
Type "bun run dev"
Enter
```

### Output

Declare output file paths (VHS compatibility). In termless, prefer the `-o` CLI
flag instead:

```tape
Output demo.gif
Output demo.png
```

## Settings

Configure the terminal environment with `Set`:

### Terminal Size

```tape
Set Width 1200
Set Height 600
```

### Font

```tape
Set FontSize 14
Set FontFamily "Menlo"
```

### Shell

```tape
Set Shell "bash"
Set Shell "/bin/zsh"
```

### Theme

```tape
Set Theme "Dracula"
Set Theme "Monokai"
```

### Visual Frame

These settings affect screenshots and animations generated from the tape:

```tape
Set Padding 18
Set BorderRadius 8
Set WindowBar "colorful"
Set WindowBarSize 40
Set Margin 24
Set MarginFill "#0b1020"
```

| Setting         | Meaning                                               |
| --------------- | ----------------------------------------------------- |
| `Padding`       | Pixels between terminal cells and the frame edge      |
| `BorderRadius`  | Radius for the terminal background rectangle          |
| `WindowBar`     | `none`, `rings`, or `colorful`                        |
| `WindowBarSize` | Height reserved for the window bar                    |
| `Margin`        | Outer image margin                                    |
| `MarginFill`    | Fill color behind the terminal frame and outer margin |

### Typing Speed

Default speed for all `Type` commands:

```tape
Set TypingSpeed 50ms
```

### Playback Output

```tape
Set PlaybackSpeed 2
Set Framerate 30
```

`PlaybackSpeed` changes how `Sleep` durations are interpreted during render.
`Framerate` caps generated animation output.

### Frames projection capture

These settings populate the Recording's **frames** projection while the tape
runs — every render-relevant buffer change is captured with a timestamp and a
content hash. See [Tracing Visual Bugs](../../guide/tracing-visual-bugs) for the
workflow.

```tape
Set Frames "/tmp/my-trace/"
Set FrameDebounceMs 16
```

| Setting           | Meaning                                                  |
| ----------------- | -------------------------------------------------------- |
| `Frames`          | Directory to write `NNNNN.png` + `index.jsonl` into      |
| `FrameDebounceMs` | Debounce interval in ms (default 16 = 60fps render-pass) |

## Duration Format

Duration values are used in `Sleep`, `Type@`, and `Set TypingSpeed`:

| Format | Meaning                      | Example          |
| ------ | ---------------------------- | ---------------- |
| `Ns`   | N seconds                    | `2s`, `0.5s`     |
| `Nms`  | N milliseconds               | `500ms`, `100ms` |
| `N`    | N milliseconds (bare number) | `200`            |

## Full Example

```tape
# Demo: build pipeline status
Set Shell "bash"
Set FontSize 14
Set Width 1200
Set Height 600

# Hide the setup
Hide
Type "cd ~/myproject"
Enter
Sleep 500ms
Show

# Show the build
Type "npm run build"
Enter
Sleep 2s
Screenshot build-start.png

# Navigate the output
Down 5
Sleep 500ms
Screenshot build-done.png
```

## VHS Compatibility

The termless `.tape` compiler accepts VHS `.tape` files. The main differences:

- **Execution is headless** -- no GUI window, no ffmpeg dependency.
- **Multi-backend** -- play against any of 10+ terminal emulators.
- **Output formats** -- GIF, animated SVG, APNG, PNG, asciicast (all pure JS, no ffmpeg).
- **Cross-terminal comparison** -- side-by-side, grid, diff modes, including pixel-diff overlays.

## See Also

- [Recording Sessions](../../guide/recording-sessions) -- recording and playback how-to.
- [.cast format](./asciicast) -- the asciinema codec.
- [.rec format](./rec) -- termless's native, all-tracks format.
