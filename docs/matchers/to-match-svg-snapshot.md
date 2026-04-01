---
title: toMatchSvgSnapshot
description: Match terminal SVG screenshot against a Vitest snapshot
---

# toMatchSvgSnapshot

Match an SVG screenshot of the terminal against a Vitest snapshot. Captures the full visual representation including colors and styling.

## Signature

```typescript
expect(term).toMatchSvgSnapshot(options?: { name?: string; theme?: SvgTheme })
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `options.name` | `string` | Optional snapshot name |
| `options.theme` | `SvgTheme` | SVG color theme to use |

## Usage

```typescript
// Basic SVG snapshot
expect(term).toMatchSvgSnapshot()

// Named snapshot
expect(term).toMatchSvgSnapshot({ name: "rendered-ui" })

// With custom theme
expect(term).toMatchSvgSnapshot({ theme: myTheme })
```

## Accepts

| Target | Supported |
|--------|-----------|
| `term` (TerminalReadable) | Yes |
| `term.screen` | No |
| `term.cell(r, c)` | No |

## Notes

- Uses Vitest's built-in snapshot machinery
- The SVG output includes colors, fonts, and styling information
- Update snapshots with `vitest --update`
- For text-only snapshots, use [toMatchTerminalSnapshot](/matchers/to-match-terminal-snapshot)

## See Also

- [toMatchTerminalSnapshot](/matchers/to-match-terminal-snapshot) - text-based snapshot
- [toMatchLines](/matchers/to-match-lines) - assert specific lines
