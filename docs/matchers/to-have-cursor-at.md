---
title: toHaveCursorAt
description: Assert that the terminal cursor is at a specific position
---

# toHaveCursorAt

::: warning Deprecated
Prefer [toHaveCursor](/matchers/to-have-cursor) which checks multiple cursor properties at once:

```typescript
expect(term).toHaveCursor({ x: 5, y: 2 })
```

:::

Assert that the terminal cursor is at the given column and row.

## Signature

```typescript
expect(term).toHaveCursorAt(x: number, y: number, options?: { timeout?: number })
```

## Parameters

| Parameter         | Type     | Description                                 |
| ----------------- | -------- | ------------------------------------------- |
| `x`               | `number` | Column (0-based)                            |
| `y`               | `number` | Row (0-based)                               |
| `options.timeout` | `number` | Auto-retry timeout in ms (Playwright-style) |

## Usage

```typescript
// Top-left corner
expect(term).toHaveCursorAt(0, 0)

// Column 5, row 2
expect(term).toHaveCursorAt(5, 2)

// With auto-retry
await expect(term).toHaveCursorAt(0, 1, { timeout: 5000 })

// Negation
expect(term).not.toHaveCursorAt(0, 0)
```

## Accepts

| Target                    | Supported |
| ------------------------- | --------- |
| `term` (TerminalReadable) | Yes       |
| `term.screen`             | No        |
| `term.cell(r, c)`         | No        |

## Notes

- Coordinates are 0-based: `(0, 0)` is the top-left corner
- `x` is the column, `y` is the row

## See Also

- [toHaveCursor](/matchers/to-have-cursor) - composable cursor matcher (preferred)
- [toHaveCursorVisible](/matchers/to-have-cursor-visible) - cursor visibility
- [toHaveCursorStyle](/matchers/to-have-cursor-style) - cursor shape
