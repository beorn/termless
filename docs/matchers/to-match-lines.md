---
title: toMatchLines
description: Assert that a terminal region's lines match an expected array
---

# toMatchLines

Assert that a region's lines match an expected array. Trailing whitespace is trimmed per line.

## Signature

```typescript
expect(region).toMatchLines(lines: string[], options?: { timeout?: number })
```

## Parameters

| Parameter         | Type       | Description                                 |
| ----------------- | ---------- | ------------------------------------------- |
| `lines`           | `string[]` | Expected lines to match                     |
| `options.timeout` | `number`   | Auto-retry timeout in ms (Playwright-style) |

## Usage

```typescript
// Match full screen content
expect(term.screen).toMatchLines(["Line 1", "Line 2", "", "Line 4"])

// With auto-retry
await expect(term.screen).toMatchLines(["Ready", ""], { timeout: 5000 })

// Negation
expect(term.screen).not.toMatchLines(["old content"])
```

## Accepts

| Region                       | Supported |
| ---------------------------- | --------- |
| `term.screen`                | Yes       |
| `term.scrollback`            | Yes       |
| `term.row(n)`                | Yes       |
| `term.range(r1, c1, r2, c2)` | Yes       |
| `term.cell(r, c)`            | No        |

## Notes

- Trailing whitespace is trimmed per line before comparison
- The number of lines must match exactly
- Empty strings in the array match blank terminal lines

## See Also

- [toContainText](/matchers/to-contain-text) - substring match
- [toHaveText](/matchers/to-have-text) - single-region exact match
