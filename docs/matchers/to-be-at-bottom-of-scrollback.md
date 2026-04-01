---
title: toBeAtBottomOfScrollback
description: Assert that the viewport is at the bottom of scrollback
---

# toBeAtBottomOfScrollback

Assert that the viewport is at the bottom of the scrollback buffer (no scroll offset).

## Signature

```typescript
expect(term).toBeAtBottomOfScrollback(options?: { timeout?: number })
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `options.timeout` | `number` | Auto-retry timeout in ms (Playwright-style) |

## Usage

```typescript
// Assert at bottom (default state)
expect(term).toBeAtBottomOfScrollback()

// With auto-retry
await expect(term).toBeAtBottomOfScrollback({ timeout: 5000 })

// Negation (user has scrolled up)
expect(term).not.toBeAtBottomOfScrollback()
```

## Accepts

| Target | Supported |
|--------|-----------|
| `term` (TerminalReadable) | Yes |
| `term.screen` | No |
| `term.cell(r, c)` | No |

## Notes

- The viewport is at the bottom when no scrollback offset is applied
- New output typically auto-scrolls to the bottom

## See Also

- [toHaveScrollbackLines](/matchers/to-have-scrollback-lines) - scrollback line count
- [toContainText](/matchers/to-contain-text) - search content
