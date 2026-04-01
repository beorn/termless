---
title: toBeBold
description: Assert that a terminal cell has bold styling
---

# toBeBold

Assert that a cell has bold styling.

## Signature

```typescript
expect(cell).toBeBold()
```

## Usage

```typescript
// Check a specific cell
expect(term.cell(0, 0)).toBeBold()

// Negation
expect(term.cell(0, 5)).not.toBeBold()
```

## Accepts

| Region | Supported |
|--------|-----------|
| `term.cell(r, c)` | Yes |
| `term.screen` | No |
| `term.row(n)` | No |

## Notes

- Works on `CellView` objects returned by `term.cell(row, col)`
- Bold is typically rendered as increased font weight or brighter colors

## See Also

- [toBeItalic](/matchers/to-be-italic) - italic styling
- [toBeDim](/matchers/to-be-dim) - dim/faint styling
- [toHaveFg](/matchers/to-have-fg) - foreground color assertion
