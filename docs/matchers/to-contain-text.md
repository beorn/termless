---
title: toContainText
description: Assert that a terminal region contains the expected text substring
---

# toContainText

Assert that a terminal region contains the given text as a substring.

## Signature

```typescript
expect(region).toContainText(text: string, options?: { timeout?: number })
```

## Parameters

| Parameter         | Type     | Description                                 |
| ----------------- | -------- | ------------------------------------------- |
| `text`            | `string` | The substring to search for                 |
| `options.timeout` | `number` | Auto-retry timeout in ms (Playwright-style) |

## Usage

```typescript
// Basic assertion
expect(term.screen).toContainText("Hello, World")

// With auto-retry (waits up to 5s for text to appear)
await expect(term.screen).toContainText("Ready", { timeout: 5000 })

// On a specific row
expect(term.row(0)).toContainText("Title")

// In scrollback
expect(term.scrollback).toContainText("earlier output")

// Negation
expect(term.screen).not.toContainText("Error")
```

## Accepts

| Region                       | Supported                                     |
| ---------------------------- | --------------------------------------------- |
| `term.screen`                | Yes                                           |
| `term.scrollback`            | Yes                                           |
| `term.row(n)`                | Yes                                           |
| `term.range(r1, c1, r2, c2)` | Yes                                           |
| `term.cell(r, c)`            | No (use [toHaveText](/matchers/to-have-text)) |

## Notes

- Comparison is case-sensitive
- Trailing whitespace in the region is trimmed before comparison
- When `timeout` is passed, the matcher polls every 50ms until the assertion passes or the timeout expires

## See Also

- [toHaveText](/matchers/to-have-text) - exact match variant
- [toMatchLines](/matchers/to-match-lines) - multi-line matching
