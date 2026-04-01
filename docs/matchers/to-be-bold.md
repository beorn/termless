---
title: toBeBold
description: Assert that a terminal cell has bold styling
---

# toBeBold

::: warning Deprecated
Prefer [toHaveAttrs](/matchers/to-have-attrs) which checks multiple attributes at once:
```typescript
expect(term.cell(0, 0)).toHaveAttrs({ bold: true })
```
:::

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

| Region            | Supported |
| ----------------- | --------- |
| `term.cell(r, c)` | Yes       |
| `term.screen`     | No        |
| `term.row(n)`     | No        |

## Notes

- Works on `CellView` objects returned by `term.cell(row, col)`
- Bold is typically rendered as increased font weight or brighter colors

## See Also

- [toHaveAttrs](/matchers/to-have-attrs) - composable attribute matcher (preferred)
- [toBeItalic](/matchers/to-be-italic) - italic styling
- [toBeDim](/matchers/to-be-dim) - dim/faint styling
- [toHaveFg](/matchers/to-have-fg) - foreground color assertion
