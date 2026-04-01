---
title: toBeInMode
description: Assert that a specific terminal mode is enabled
---

# toBeInMode

Assert that a specific terminal mode is enabled.

## Signature

```typescript
expect(term).toBeInMode(mode: TerminalMode, options?: { timeout?: number })
```

## Parameters

| Parameter         | Type           | Description                                 |
| ----------------- | -------------- | ------------------------------------------- |
| `mode`            | `TerminalMode` | The mode to check                           |
| `options.timeout` | `number`       | Auto-retry timeout in ms (Playwright-style) |

Available modes:

| Mode                  | Description                           |
| --------------------- | ------------------------------------- |
| `"altScreen"`         | Alternate screen buffer (DECSET 1049) |
| `"cursorVisible"`     | Cursor visibility (DECTCEM)           |
| `"bracketedPaste"`    | Bracketed paste mode                  |
| `"applicationCursor"` | Application cursor keys (DECCKM)      |
| `"applicationKeypad"` | Application keypad mode               |
| `"autoWrap"`          | Auto-wrap at line end (DECAWM)        |
| `"mouseTracking"`     | Mouse tracking enabled                |
| `"focusTracking"`     | Focus in/out events                   |
| `"originMode"`        | Origin mode (DECOM)                   |
| `"insertMode"`        | Insert mode (IRM)                     |
| `"reverseVideo"`      | Reverse video (DECSCNM)               |

## Usage

```typescript
// Check alternate screen
expect(term).toBeInMode("altScreen")

// Check bracketed paste
expect(term).toBeInMode("bracketedPaste")

// Check mouse tracking
expect(term).toBeInMode("mouseTracking")

// Negation
expect(term).not.toBeInMode("insertMode")

// With auto-retry
await expect(term).toBeInMode("altScreen", { timeout: 5000 })
```

## Accepts

| Target                    | Supported |
| ------------------------- | --------- |
| `term` (TerminalReadable) | Yes       |
| `term.screen`             | No        |
| `term.cell(r, c)`         | No        |

## See Also

- [toHaveTitle](/matchers/to-have-title) - terminal title assertion
- [toHaveCursorVisible](/matchers/to-have-cursor-visible) - cursor visibility
