---
title: toHaveText
description: Assert that a terminal region's text matches exactly after trimming
---

# toHaveText

Assert that a region's text matches exactly after trimming trailing whitespace.

## Signature

```typescript
expect(region).toHaveText(text: string, options?: { timeout?: number })
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `text` | `string` | The exact text to match |
| `options.timeout` | `number` | Auto-retry timeout in ms (Playwright-style) |

## Usage

```typescript
// Exact match on a row
expect(term.row(0)).toHaveText("Title")

// Full screen match
expect(term.row(2)).toHaveText("status: ok")

// With auto-retry
await expect(term.row(0)).toHaveText("Ready", { timeout: 5000 })

// Negation
expect(term.row(0)).not.toHaveText("Loading...")
```

## Accepts

| Region | Supported |
|--------|-----------|
| `term.screen` | Yes |
| `term.scrollback` | Yes |
| `term.row(n)` | Yes |
| `term.range(r1, c1, r2, c2)` | Yes |
| `term.cell(r, c)` | No |

## Notes

- Trailing whitespace is trimmed before comparison
- For substring matching, use [toContainText](/matchers/to-contain-text)

## See Also

- [toContainText](/matchers/to-contain-text) - substring match
- [toMatchLines](/matchers/to-match-lines) - multi-line matching
