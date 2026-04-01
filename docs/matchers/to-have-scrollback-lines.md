---
title: toHaveScrollbackLines
description: Assert that the scrollback buffer has a specific number of lines
---

# toHaveScrollbackLines

Assert that the scrollback buffer contains a specific number of total lines.

## Signature

```typescript
expect(term).toHaveScrollbackLines(n: number, options?: { timeout?: number })
```

## Parameters

| Parameter         | Type     | Description                                 |
| ----------------- | -------- | ------------------------------------------- |
| `n`               | `number` | Expected number of scrollback lines         |
| `options.timeout` | `number` | Auto-retry timeout in ms (Playwright-style) |

## Usage

```typescript
// Check scrollback size
expect(term).toHaveScrollbackLines(100)

// With auto-retry
await expect(term).toHaveScrollbackLines(50, { timeout: 5000 })

// Negation
expect(term).not.toHaveScrollbackLines(0)
```

## Accepts

| Target                    | Supported |
| ------------------------- | --------- |
| `term` (TerminalReadable) | Yes       |
| `term.screen`             | No        |
| `term.cell(r, c)`         | No        |

## See Also

- [toBeAtBottomOfScrollback](/matchers/to-be-at-bottom-of-scrollback) - scroll position
- [toContainText](/matchers/to-contain-text) - search scrollback content
