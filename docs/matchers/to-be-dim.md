---
title: toBeDim
description: Assert that a terminal cell has dim (faint) styling
---

# toBeDim

::: warning Deprecated
Prefer [toHaveAttrs](/matchers/to-have-attrs) which checks multiple attributes at once:
```typescript
expect(term.cell(0, 0)).toHaveAttrs({ dim: true })
```
:::

Assert that a cell has dim (faint) styling. Also known as `toBeFaint` in some terminal documentation.

## Signature

```typescript
expect(cell).toBeDim()
```

## Usage

```typescript
// Check a specific cell
expect(term.cell(0, 0)).toBeDim()

// Negation
expect(term.cell(0, 5)).not.toBeDim()
```

## Accepts

| Region            | Supported |
| ----------------- | --------- |
| `term.cell(r, c)` | Yes       |
| `term.screen`     | No        |
| `term.row(n)`     | No        |

## Notes

- Dim text is rendered at reduced intensity (SGR attribute 2)
- Some terminals render dim as a lighter shade of the foreground color

## See Also

- [toHaveAttrs](/matchers/to-have-attrs) - composable attribute matcher (preferred)
- [toBeBold](/matchers/to-be-bold) - bold styling
- [toBeItalic](/matchers/to-be-italic) - italic styling
- [toHaveFg](/matchers/to-have-fg) - foreground color assertion
