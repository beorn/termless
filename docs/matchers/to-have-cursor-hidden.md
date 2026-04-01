---
title: toHaveCursorHidden
description: Assert that the terminal cursor is hidden
---

# toHaveCursorHidden

Assert that the terminal cursor is hidden.

## Signature

```typescript
expect(term).toHaveCursorHidden(options?: { timeout?: number })
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `options.timeout` | `number` | Auto-retry timeout in ms (Playwright-style) |

## Usage

```typescript
// Assert cursor is hidden (e.g., after DECTCEM hide)
expect(term).toHaveCursorHidden()

// With auto-retry
await expect(term).toHaveCursorHidden({ timeout: 5000 })

// Negation
expect(term).not.toHaveCursorHidden()
```

## Accepts

| Target | Supported |
|--------|-----------|
| `term` (TerminalReadable) | Yes |
| `term.screen` | No |
| `term.cell(r, c)` | No |

## Notes

- TUI applications typically hide the cursor during rendering and show it at the input position

## See Also

- [toHaveCursorVisible](/matchers/to-have-cursor-visible) - assert cursor is visible
- [toHaveCursorAt](/matchers/to-have-cursor-at) - cursor position
