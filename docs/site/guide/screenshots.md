# SVG Screenshots

termless generates SVG screenshots from terminal state -- no Chromium, no native dependencies. SVGs render text, colors, bold/italic/underline/strikethrough, cursor, and background colors.

## Basic Usage

```typescript
import { createTerminal } from "@termless/core"
import { createXtermBackend } from "@termless/xtermjs"

const term = createTerminal({ backend: createXtermBackend(), cols: 80, rows: 24 })
term.feed("\x1b[1;38;2;255;85;85mError:\x1b[0m file not found")

const svg = term.screenshotSvg()
```

## Saving to File

```typescript
import { writeFile } from "node:fs/promises"

const svg = term.screenshotSvg()
await writeFile("/tmp/terminal.svg", svg, "utf-8")
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

## Standalone Function

You can also use `screenshotSvg()` directly on any `TerminalReadable`:

```typescript
import { screenshotSvg } from "termless/svg"

const svg = screenshotSvg(term, { theme: { background: "#000" } })
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
