---
title: toBeItalic
description: Assert that a terminal cell has italic styling
---

# toBeItalic

::: warning Deprecated
Prefer [toHaveAttrs](/matchers/to-have-attrs) which checks multiple attributes at once:

```typescript
expect(term.cell(0, 0)).toHaveAttrs({ italic: true })
```

:::

Assert that a cell has italic styling.

## Signature

```typescript
expect(cell).toBeItalic()
```

## Usage

```typescript
// Check a specific cell
expect(term.cell(0, 0)).toBeItalic()

// Negation
expect(term.cell(0, 5)).not.toBeItalic()
```

## Accepts

| Region            | Supported |
| ----------------- | --------- |
| `term.cell(r, c)` | Yes       |
| `term.screen`     | No        |
| `term.row(n)`     | No        |

## See Also

- [toHaveAttrs](/matchers/to-have-attrs) - composable attribute matcher (preferred)
- [toBeBold](/matchers/to-be-bold) - bold styling
- [toBeDim](/matchers/to-be-dim) - dim/faint styling
- [toHaveUnderline](/matchers/to-have-underline) - underline styling
