---
title: Matcher Reference
description: Complete reference for all Termless Vitest matchers
---

# Matcher Reference

Termless provides 22 custom Vitest matchers for terminal assertions. All matchers support `.not` negation.

```typescript
import "@termless/test/matchers" // Auto-registers all matchers
```

## Text Matchers

Work on `RegionView` (screen, scrollback, row, range).

- [toContainText](/matchers/to-contain-text) - Assert region contains text substring
- [toHaveText](/matchers/to-have-text) - Assert exact text match (after trimming)
- [toMatchLines](/matchers/to-match-lines) - Assert multi-line content

## Style Matchers

Work on `CellView` via `term.cell(row, col)`.

- [toBeBold](/matchers/to-be-bold) - Assert bold styling
- [toBeItalic](/matchers/to-be-italic) - Assert italic styling
- [toBeDim](/matchers/to-be-dim) - Assert dim/faint styling
- [toBeStrikethrough](/matchers/to-be-strikethrough) - Assert strikethrough
- [toBeInverse](/matchers/to-be-inverse) - Assert inverse/reverse video
- [toBeWide](/matchers/to-be-wide) - Assert double-width character
- [toHaveUnderline](/matchers/to-have-underline) - Assert underline with optional style
- [toHaveFg](/matchers/to-have-fg) - Assert foreground color
- [toHaveBg](/matchers/to-have-bg) - Assert background color

## Cursor Matchers

Work on `TerminalReadable` (the terminal itself).

- [toHaveCursorAt](/matchers/to-have-cursor-at) - Assert cursor position
- [toHaveCursorStyle](/matchers/to-have-cursor-style) - Assert cursor shape
- [toHaveCursorVisible](/matchers/to-have-cursor-visible) - Assert cursor is visible
- [toHaveCursorHidden](/matchers/to-have-cursor-hidden) - Assert cursor is hidden

## Terminal State Matchers

Work on `TerminalReadable` (the terminal itself).

- [toBeInMode](/matchers/to-be-in-mode) - Assert terminal mode is enabled
- [toHaveTitle](/matchers/to-have-title) - Assert terminal title
- [toHaveScrollbackLines](/matchers/to-have-scrollback-lines) - Assert scrollback line count
- [toBeAtBottomOfScrollback](/matchers/to-be-at-bottom-of-scrollback) - Assert no scroll offset
- [toHaveClipboardText](/matchers/to-have-clipboard-text) - Assert OSC 52 clipboard content

## Snapshot Matchers

Work on `TerminalReadable` (the terminal itself).

- [toMatchTerminalSnapshot](/matchers/to-match-terminal-snapshot) - Match against Vitest snapshot
- [toMatchSvgSnapshot](/matchers/to-match-svg-snapshot) - Match SVG screenshot against snapshot
