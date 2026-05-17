---
title: Screenshots
description: Generate SVG and PNG screenshots from terminal state, with a fast default renderer and an optional Playwright renderer for browser-shaped text.
---

# Screenshots

Termless generates screenshots from terminal state. SVG is built in with zero dependencies. The default PNG renderer uses optional `@resvg/resvg-js` and does not need Chromium. A separate Playwright renderer is available for docs and marketing screenshots where browser font shaping matters more than startup cost.

For one-off command-output images, use `termless record --screenshot`. For reproducible docs, demos, and regression fixtures, write a `.tape` and render it with `termless play`. Both paths render from parsed terminal state, so ANSI styling, cursor state, and screen geometry stay inspectable before they become an image.

## Basic Usage

```typescript
import { createTerminal } from "@termless/core"
import { createXtermBackend } from "@termless/xtermjs"

const term = createTerminal({ backend: createXtermBackend(), cols: 80, rows: 24 })
term.feed("\x1b[1;38;2;255;85;85mError:\x1b[0m file not found")

const svg = term.screenshotSvg()
const png = await term.screenshotPng() // requires: bun add -d @resvg/resvg-js
const browserPng = await term.screenshotPlaywrightPng() // requires: bun add -d playwright && bunx playwright install chromium
```

## Saving to File

```typescript
import { writeFile } from "node:fs/promises"

// SVG
const svg = term.screenshotSvg()
await writeFile("/tmp/terminal.svg", svg, "utf-8")

// PNG (requires @resvg/resvg-js)
const png = await term.screenshotPng()
await writeFile("/tmp/terminal.png", png)

// Browser-shaped PNG (requires playwright + Chromium)
const browserPng = await term.screenshotPlaywrightPng()
await writeFile("/tmp/terminal-browser.png", browserPng)
```

## Options

`screenshotSvg()` accepts an optional `SvgScreenshotOptions` object:

```typescript
const svg = term.screenshotSvg({
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 16,
  cellWidth: 9.6,
  cellHeight: 20,
  padding: 16,
  borderRadius: 8,
  windowBar: "colorful",
  margin: 24,
  marginFill: "#111827",
  theme: {
    foreground: "#f8f8f2",
    background: "#282a36",
    cursor: "#f8f8f0",
    palette: { 1: "#ff5555", 2: "#50fa7b" },
  },
})
```

| Option          | Type                              | Default                                         | Description                                     |
| --------------- | --------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| `fontFamily`    | `string`                          | `"'Menlo', 'Monaco', 'Courier New', monospace"` | CSS font-family for text                        |
| `fontSize`      | `number`                          | `16`                                            | Font size in px                                 |
| `cellWidth`     | `number`                          | `9.6`                                           | Character cell width in px                      |
| `cellHeight`    | `number`                          | `20`                                            | Character cell height in px                     |
| `theme`         | `SvgTheme`                        | _(dark theme)_                                  | Color theme                                     |
| `padding`       | `number`                          | `0`                                             | Padding between terminal cells and the frame    |
| `borderRadius`  | `number`                          | `0`                                             | Radius for the terminal background rectangle    |
| `windowBar`     | `"none" \| "rings" \| "colorful"` | `"none"`                                        | Optional macOS-style window controls            |
| `windowBarSize` | `number`                          | `40`                                            | Height reserved for the window bar              |
| `margin`        | `number`                          | `0`                                             | Outer image margin                              |
| `marginFill`    | `string`                          | transparent                                     | Fill color behind the terminal frame and margin |

## Polished Frames

Use visual frame options when the screenshot is meant for docs, blog posts, or release notes:

```typescript
const png = await term.screenshotPng({
  theme: { background: "#111827", foreground: "#f9fafb" },
  padding: 18,
  borderRadius: 8,
  windowBar: "colorful",
  margin: 24,
  marginFill: "#0b1020",
})
```

The same options are available from `.tape` settings and `termless play` flags:

```tape
Set Theme "github-dark"
Set Padding 18
Set BorderRadius 8
Set WindowBar "colorful"
Set Margin 24
Set MarginFill "#0b1020"

Type "bun test"
Enter
Sleep 1s
Screenshot build.png
```

```bash
termless play demo.tape -o demo.png --window-bar colorful --padding 18 --margin 24 --margin-fill '#0b1020'
```

## Command Output Captures

For a single command, `termless record --screenshot` is the shortest path:

```bash
termless record --cols 100 --rows 30 --screenshot /tmp/listing.png -- ls -la
```

This runs the command in a PTY, waits for content, captures the terminal state, and writes SVG or PNG based on the filename extension. Add `--keys` and `--wait-for` for simple interactive captures:

```bash
termless record --wait-for "ready>" --keys j,j,Enter --screenshot /tmp/app.svg -- bun km view /path/to/vault
```

Use `.tape` when the capture needs setup, timing, hidden commands, multiple screenshots, or a future GIF/APNG/SVG recording.

## SvgTheme

| Field        | Type                     | Default     | Description                          |
| ------------ | ------------------------ | ----------- | ------------------------------------ |
| `foreground` | `string`                 | `"#d4d4d4"` | Default text color                   |
| `background` | `string`                 | `"#1e1e1e"` | Background color                     |
| `cursor`     | `string`                 | `"#aeafad"` | Cursor color                         |
| `palette`    | `Record<number, string>` | --          | Override ANSI palette colors (0-255) |

## PNG Options

`screenshotPng()` accepts a `PngScreenshotOptions` object (extends `SvgScreenshotOptions` with an additional `scale` option):

```typescript
const png = await term.screenshotPng({
  scale: 2, // default: 2 (retina-quality)
  theme: { background: "#282a36" },
})
```

| Option  | Type     | Default | Description                           |
| ------- | -------- | ------- | ------------------------------------- |
| `scale` | `number` | `2`     | Render scale factor (1 = actual size) |

All `SvgScreenshotOptions` (`fontFamily`, `fontSize`, `cellWidth`, `cellHeight`, `theme`) are also accepted.

## Playwright PNG Options

`screenshotPlaywrightPng()` accepts a `PlaywrightScreenshotOptions` object. It extends `SvgScreenshotOptions`, uses the same `scale` default as `screenshotPng()`, and passes `launchOptions` through to `chromium.launch()`.

Install both the Playwright package and the Chromium browser binary:

```bash
bun add -d playwright
bunx playwright install chromium
```

```typescript
const png = await term.screenshotPlaywrightPng({
  scale: 2,
  fontFamily: "'Fira Code', monospace",
  launchOptions: { channel: "chrome" },
})
```

Use this path when browser font rendering or ligature shaping is the point of the screenshot. Use `screenshotPng()` for deterministic test snapshots and fast CI output.

| Option          | Type      | Default | Description                                      |
| --------------- | --------- | ------- | ------------------------------------------------ |
| `scale`         | `number`  | `2`     | Browser device scale factor                      |
| `launchOptions` | `unknown` | --      | Passed through to Playwright `chromium.launch()` |
| `playwright`    | `object`  | --      | Inject a loaded Playwright module                |

## Standalone Functions

You can also use the screenshot functions directly on any `TerminalReadable`:

```typescript
import { screenshotSvg } from "@termless/core/svg"
import { screenshotPng } from "@termless/core/png"
import { screenshotPlaywrightPng } from "@termless/core/playwright"

const svg = screenshotSvg(term, { theme: { background: "#000" } })
const png = await screenshotPng(term, { scale: 3 })
const browserPng = await screenshotPlaywrightPng(term, { scale: 2 })
```

## What Gets Rendered

- Text content with proper monospace positioning
- Foreground colors (ANSI 16, 256-color, truecolor)
- Background colors (merged into rectangles for adjacent same-color cells)
- Bold (via `font-weight="bold"`)
- Italic (via `font-style="italic"`)
- Faint/dim (via `opacity="0.5"`)
- Underline (via `text-decoration="underline"`)
- Strikethrough (via `text-decoration="line-through"`)
- Inverse video (fg/bg swapped)
- Wide characters (double-width CJK, emoji)
- Cursor (block, underline, or beam -- with semi-transparent overlay)
