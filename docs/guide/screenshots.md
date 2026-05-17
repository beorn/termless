---
title: Screenshots
description: Generate SVG and PNG screenshots from terminal state, with a fast default renderer and an optional Playwright renderer for browser-shaped text.
---

# Screenshots

Termless generates screenshots from terminal state. SVG is built in with zero dependencies. The default PNG renderer uses optional `@resvg/resvg-js` and does not need Chromium. A separate Playwright renderer is available for docs and marketing screenshots where browser font shaping matters more than startup cost.

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
  fontSize: 14,
  cellWidth: 8.4,
  cellHeight: 18,
  theme: {
    foreground: "#f8f8f2",
    background: "#282a36",
    cursor: "#f8f8f0",
    palette: { 1: "#ff5555", 2: "#50fa7b" },
  },
})
```

| Option       | Type       | Default                                         | Description                 |
| ------------ | ---------- | ----------------------------------------------- | --------------------------- |
| `fontFamily` | `string`   | `"'Menlo', 'Monaco', 'Courier New', monospace"` | CSS font-family for text    |
| `fontSize`   | `number`   | `14`                                            | Font size in px             |
| `cellWidth`  | `number`   | `8.4`                                           | Character cell width in px  |
| `cellHeight` | `number`   | `18`                                            | Character cell height in px |
| `theme`      | `SvgTheme` | _(dark theme)_                                  | Color theme                 |

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
