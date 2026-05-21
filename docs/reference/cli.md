---
title: CLI Reference
description: The Termless CLI — the four recording-domain verbs (record, view, play, compare) plus the config and diagnostic surfaces.
---

# CLI Reference

The `@termless/cli` package is a command-line tool built around the four
[recording-domain verbs](../concepts/overview#the-four-verbs) — **`record`**,
**`view`**, **`play`**, **`compare`** — plus the config and diagnostic surfaces
`backends`, `doctor`, `themes`, and the `mcp` server.

For the MCP server tool list, see the [MCP Reference](./mcp).

## Installation

::: code-group

```bash [npm]
npm install @termless/cli
```

```bash [bun]
bun add @termless/cli
```

```bash [pnpm]
pnpm add @termless/cli
```

```bash [yarn]
yarn add @termless/cli
```

:::

Or run directly:

```bash
$ bunx termless record -o demo.gif -- bun km view ~/Vault
```

## `termless record` {#record}

Capture a terminal session into a [Recording](../concepts/recording) and write
it to one or more output files. Alias: `termless rec`.

`record` has exactly **one output flag — `-o`**. The _shape_ of each `-o`
value picks the mode; there is no separate format flag and no separate
screenshot flag.

| Invocation                             | Output                                                            |
| -------------------------------------- | ----------------------------------------------------------------- |
| `termless record -- <cmd>` (no `-o`)   | `out.gif` — a single file in the cwd                              |
| `termless record -o demos/ -- <cmd>`   | `demos/` folder — `out.rec` · `out.gif` · `out.cast` · `out.tape` |
| `termless record -o a.gif -o b.cast`   | exactly `a.gif` + `b.cast` (`-o` is repeatable)                   |
| `termless record -o shot.png -- <cmd>` | a single still PNG                                                |
| `termless record` (no command)         | shows a help gate, then records a live `$SHELL` on Enter          |

The `-o` extension picks the format; the format decides whether a renderer
is involved:

| Extension              | Format                    | Renderer                          |
| ---------------------- | ------------------------- | --------------------------------- |
| `.gif` `.apng`         | raster animation          | the renderer — `auto` (see below) |
| `.png`                 | raster still              | the renderer — `auto` (see below) |
| `.svg`                 | vector still/animation    | none (vector)                     |
| `.html`                | scrubbable browser viewer | none server-side                  |
| `.rec` `.tape` `.cast` | recording data            | none                              |

### Renderers

A **renderer** rasterizes captured frames into pixels. `--renderer` picks one;
the default is `auto`.

| Renderer  | How it works                                                                                                                                                                                                                               | Use it for                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `swash`   | Renders the **cell grid directly** (no SVG) via the pure-Rust `swash` crate — composites **full-colour emoji** from their native colour tables. Bundled font chain: JetBrains Mono + Noto Sans Symbols 2 + Symbols Nerd Font + Noto Emoji. | The default — highest fidelity.                                                |
| `resvg`   | Renders each frame's SVG via `@resvg/resvg-js`, handed the same bundled fonts. Clean glyph coverage; no native build.                                                                                                                      | Cross-platform fallback.                                                       |
| `canvas`  | Rasterizes the SVG through `@napi-rs/canvas`. Its `drawImage` path ignores registered fonts, so some glyphs tofu.                                                                                                                          | Niche; prefer `resvg`.                                                         |
| `browser` | Rasterizes each frame's SVG in **headless Chromium** (Playwright) — a real browser text engine for Chrome-identical shaping, font fallback, ligatures, and colour emoji. **Absolute-max fidelity.**                                        | Premium opt-in: marketing assets + a fidelity oracle against `swash`/`canvas`. |
| `auto`    | Resolves to `swash`, falling back to `resvg` then `canvas`. Never `browser`.                                                                                                                                                               | The default.                                                                   |

`auto` prefers `swash` — it consumes the cell grid directly, so colour emoji,
Nerd Font icons and box-drawing all render faithfully. Where the swash native
binding is unavailable it falls back to `resvg`, which renders the SVG path
with the same bundled fonts.

### `browser` — the premium opt-in tier

`browser` is the **highest-fidelity** renderer: it hosts each frame's SVG in a
headless-Chromium page and screenshots it, so output matches Chrome exactly
(shaping, fallback, ligatures, colour emoji). It is **opt-in only** and never
chosen by `auto` — Chromium is a hundreds-of-MB dependency, too heavy for a
default or CI. Reach for it for one-off README/blog assets, or as a correctness
**oracle** (render the same frame via `browser` and `swash`, diff them).

Playwright is an **optional** dependency — a default `bun install` omits it and
`swash`/`resvg`/`canvas` are unaffected. Install it before using `--renderer
browser`:

```bash
bun add -d playwright
npx playwright install chromium
```

Without playwright, `--renderer browser` fails fast with that exact install
hint.

```bash
# Bare record — shows a help gate, then records a live $SHELL on Enter
$ termless record

# Record a command — no -o → out.gif in the cwd
$ termless record -- bun km view ~/Vault

# Folder bundle — a trailing slash writes out.{rec,gif,cast,tape}
$ termless record -o demos/ -- bun km view ~/Vault

# Named files — -o is repeatable; the extension picks the format
$ termless record -o demo.gif -o demo.cast -- bun km view ~/Vault

# A single still PNG
$ termless record -o shot.png -- bun km view ~/Vault

# Force the resvg renderer (the common case never touches --renderer)
$ termless record --renderer resvg -o demo.gif -- bun km view ~/Vault

# Compat capture: record in a real desktop terminal app (macOS)
$ termless record --compat -o c.png -- bun km view ~/Vault
```

### Options

| Option                   | Description                                                                         | Default     |
| ------------------------ | ----------------------------------------------------------------------------------- | ----------- |
| `-o, --output <path...>` | Output path — extension picks the format, trailing `/` a folder bundle (repeatable) | `out.gif`   |
| `--renderer <kind>`      | Raster renderer: `resvg`, `swash`, `canvas`, `browser`, or `auto`                   | `auto`      |
| `-t, --tape <commands>`  | Inline tape commands (scripted mode)                                                | --          |
| `-b, --backend <name>`   | Backend for scripted mode                                                           | vterm       |
| `--cols <n>`             | Terminal columns                                                                    | `80`        |
| `--rows <n>`             | Terminal rows                                                                       | `30`        |
| `--scale <n>`            | Raster resolution multiplier for `.gif`/`.apng`/`.png` — `1` native, `2` retina     | `2`         |
| `--timeout <ms>`         | Wait timeout in ms                                                                  | `5000`      |
| `--keys <keys>`          | Comma-separated key names to press, then capture a still                            | --          |
| `--wait-for <text>`      | Wait for text before pressing keys                                                  | `content`   |
| `--text`                 | Print terminal text to stdout                                                       | off         |
| `--compat`               | Compat capture — record in a real desktop terminal app                              | off         |
| `--terminal <name>`      | Compat terminal app: `ghostty`, `kitty`, `iterm`, `terminal`                        | auto-detect |
| `--cwd <path>`           | Working directory for the recorded command (with `--compat`)                        | --          |

`record`'s defaults are tuned for a README-droppable artifact: the `ghostty`
backend (truecolor + real glyph shaping), `80×30` (GitHub renders README
images at ~880px content width), ~12 fps, and a ~300-frame cap so a long
session never produces a 50 MB GIF. Power users override every default.

`--scale` controls the raster resolution of `.gif` / `.apng` / `.png` output.
The default `2` doubles the renderer's native cell metrics — an `80×30` grid
(768×600 native) becomes 1536×1200, which GitHub downscales to its ~880px
content width as crisp 2× DPI. Use `--scale 1` for a smaller file at native
size, or `--scale 3`+ for print-grade stills.

### Compat capture (macOS) {#compat}

`termless record --compat` records against the **peekaboo** backend — it spawns
the user's real desktop terminal app (Ghostty / kitty / iTerm / Terminal.app),
runs the command after `--`, screenshots the window, and cleans up. Pixel-perfect
for that terminal plus the user's font and theme.

```bash
$ termless record --compat -- bun km view ~/Vault
$ termless record --compat --terminal ghostty --cols 140 --rows 40 -o c.png -- bun km
```

Compat capture is macOS-only and needs a GUI session plus Screen Recording
permission. For routine visual iteration use plain `record` (the resvg
renderer) — the compat path is slow and pops a real window.

See [Recording Sessions](../guide/recording-sessions) for detailed usage.

## `termless view` {#view}

Present a recording — a single `.rec` file or a bare frame-trace directory. By
default `view` writes a self-contained, scrubbable `viewer.html` alongside the
recording; with `--format gif` it animates the recording's frames into a GIF.

```bash
# Scrub a recording in the browser (writes viewer.html next to it)
$ termless view ./mysession.rec

# Animate a recording to a GIF
$ termless view ./trace --format gif -o demo.gif
```

### Options

| Option                | Description                            | Default |
| --------------------- | -------------------------------------- | ------- |
| `-o, --output <path>` | Output file for `--format`             | --      |
| `--format <type>`     | Animate the recording to a file: `gif` | scrub   |

Writing a GIF is not a separate "export" command — it is `view` with an
animation format and a file sink. See
[Tracing Visual Bugs](../guide/tracing-visual-bugs) for the scrubbable viewer.

## `termless play` {#play}

Re-execute a recording into a terminal. Accepts any recording format. Produce
terminal text, screenshots, or animated output.

```bash
# Play a recording (prints terminal text)
$ termless play demo.tape
$ termless play demo.cast

# Generate an animated GIF
$ termless play -o demo.gif demo.tape

# Generate an animated SVG
$ termless play -o demo.svg demo.tape
```

### Options

| Option                 | Description                                                    | Default |
| ---------------------- | -------------------------------------------------------------- | ------- |
| `-o, --output <path>`  | Output file, format detected from extension                    | --      |
| `-b, --backend <name>` | Backend(s), comma-separated; use `all` for every ready backend | vterm   |
| `--compare <mode>`     | Comparison mode — a thin alias for `termless compare`          | --      |
| `--cols <n>`           | Override terminal columns                                      | --      |
| `--rows <n>`           | Override terminal rows                                         | --      |

## `termless compare` {#compare}

Play one recording across two or more backends and diff the results — "does my
TUI look the same in every terminal?" `compare` shares its execution core with
`play`; `play --compare <mode>` is a thin alias for it.

```bash
# Side-by-side comparison
$ termless compare demo.tape -b vterm,ghostty --compare side-by-side -o comparison.svg

# Compare every installed, ready backend
$ termless compare demo.tape -b all --compare grid -o all-backends.svg

# Diff mode — pixel-diff overlays against the baseline backend
$ termless compare demo.tape -b vterm,ghostty --compare diff -o diff.svg
```

### Options

| Option                 | Description                                                    | Default |
| ---------------------- | -------------------------------------------------------------- | ------- |
| `-b, --backend <name>` | Backend(s), comma-separated; use `all` for every ready backend | vterm   |
| `--compare <mode>`     | `separate`, `side-by-side`, `grid`, `diff`                     | --      |
| `-o, --output <path>`  | Output file or directory                                       | --      |

See [Recording Sessions](../guide/recording-sessions) for the comparison modes.

## Backend Management {#backends}

Manage backend installation with Playwright-inspired commands. Backend versions
are pinned in `backends.json` — upgrading termless upgrades all backends together.

### `termless backends`

List all available backends with their type, install status, and version.
`termless backends list` is the same command.

```bash
$ termless backends
$ termless backends list
```

### `termless backends install`

Install backends. With no arguments, installs the default set (xtermjs, ghostty,
vt100).

```bash
$ termless backends install
$ termless backends install ghostty
$ termless backends install ghostty alacritty
```

### `termless backends update`

Check upstream registries (npm, crates.io, GitHub) for newer backend versions,
compared against the versions pinned in `backends.json`.

```bash
$ termless backends update           # dry run
$ termless backends update --apply   # apply to backends.json
```

## `termless doctor` {#doctor}

Check installation health: verify installed backends load correctly, detect
version mismatches, and report missing dependencies.

```bash
$ termless doctor
```

## `termless themes` {#themes}

List the color themes available for recording screenshots and animations.

```bash
$ termless themes
```

Use a theme with `termless play --theme dracula demo.tape`, or `Set Theme "dracula"`
inside a `.tape` file.

## `termless mcp` {#mcp}

Start a stdio MCP server for AI agents (Claude Code, etc.).

```bash
$ termless mcp
```

The full tool list and Claude Code integration are documented in the
[MCP Reference](./mcp).

## Session Manager (Programmatic)

The session manager is also available as a library:

```typescript
import { createSessionManager } from "@termless/cli"

const manager = createSessionManager()

const { id, terminal } = await manager.createSession({
  command: ["my-app"],
  cols: 120,
  rows: 40,
  waitFor: "ready>",
  timeout: 5000,
})

terminal.press("ArrowDown")
await terminal.waitForStable()
console.log(terminal.getText())

await manager.stopSession(id)
// or: await manager.stopAll()
```

### `createSession(options?)`

| Option    | Type                              | Default     | Description                  |
| --------- | --------------------------------- | ----------- | ---------------------------- |
| `command` | `string[]`                        | --          | Command to spawn             |
| `env`     | `Record<string, string>`          | --          | Additional env vars          |
| `cwd`     | `string`                          | --          | Working directory            |
| `cols`    | `number`                          | `120`       | Terminal columns             |
| `rows`    | `number`                          | `40`        | Terminal rows                |
| `waitFor` | `string \| "content" \| "stable"` | `"content"` | What to wait for after spawn |
| `timeout` | `number`                          | `5000`      | Wait timeout in ms           |

### `getSession(id)`

Get a Terminal instance by session ID. Throws if not found.

### `listSessions()`

Returns an array of `{ id, command, cols, rows, alive }` for all sessions.

### `stopSession(id)` / `stopAll()`

Close the terminal and kill the process for one or all sessions.

## Key Names

Keys use the same format as `terminal.press()`:

- Single characters: `a`, `1`, `/`
- Named keys: `Enter`, `Tab`, `Backspace`, `Delete`, `Escape`, `Space`
- Arrow keys: `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`
- Navigation: `Home`, `End`, `PageUp`, `PageDown`
- Function keys: `F1` through `F12`
- With modifiers: `Ctrl+c`, `Shift+Tab`, `Alt+x`
