---
title: Tape Format Reference
description: Complete reference for the .tape file format -- commands, settings, duration syntax, and examples.
---

# Tape Format Reference

The `.tape` format is a line-based DSL for scripting terminal sessions. It is compatible with [VHS](https://github.com/charmbracelet/vhs) by Charmbracelet, but termless adds headless execution and multi-backend playback.

## Overview

A `.tape` file is a sequence of commands, one per line. Blank lines and comments (lines starting with `#`) are ignored.

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

Capture a screenshot of the current terminal state:

```tape
# Screenshot with auto-generated path
Screenshot

# Screenshot to a specific file
Screenshot /tmp/demo.png
```

### Hide / Show

Control whether terminal output is visible during playback. Useful for skipping setup steps in animations:

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

Declare output file paths (VHS compatibility). In termless, prefer the `-o` CLI flag instead:

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

### Typing Speed

Default speed for all `Type` commands:

```tape
Set TypingSpeed 50ms
```

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

## Running Tape Files

```bash
# Play a tape and see the output
$ termless play demo.tape

# Play and generate a GIF
$ termless play -o demo.gif demo.tape

# Play against a specific backend
$ termless play -b ghostty demo.tape

# Play with cross-terminal comparison
$ termless play -b vterm,ghostty --compare side-by-side demo.tape
```

## VHS Compatibility

The termless tape parser is compatible with VHS `.tape` files. The main differences:

- **Execution is headless** -- no GUI window, no ffmpeg dependency
- **Multi-backend** -- play against any of 10+ terminal emulators
- **Output formats** -- GIF, animated SVG, APNG, PNG, asciicast (all pure JS, no ffmpeg)
- **Cross-terminal comparison** -- side-by-side, grid, diff modes

## See Also

- [Recording & Playback](/guide/recording) -- CLI usage and recording modes
- [Asciicast v2](/guide/asciicast) -- asciicast format for asciinema compatibility
