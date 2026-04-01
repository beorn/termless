---
title: toBeStrikethrough
description: Assert that a terminal cell has strikethrough styling
---

# toBeStrikethrough

::: warning Deprecated
Prefer [toHaveAttrs](/matchers/to-have-attrs) which checks multiple attributes at once:

```typescript
expect(term.cell(0, 0)).toHaveAttrs({ strikethrough: true })
```

:::

Assert that a cell has strikethrough (crossed-out) styling.

## Signature

```typescript
expect(cell).toBeStrikethrough()
```

## Usage

```typescript
// Check a specific cell
expect(term.cell(0, 0)).toBeStrikethrough()

// Negation
expect(term.cell(0, 5)).not.toBeStrikethrough()
```

## Accepts

| Region            | Supported |
| ----------------- | --------- |
| `term.cell(r, c)` | Yes       |
| `term.screen`     | No        |
| `term.row(n)`     | No        |

## Notes

- Strikethrough is SGR attribute 9
- Not all terminal emulators render strikethrough visually

## See Also

- [toHaveAttrs](/matchers/to-have-attrs) - composable attribute matcher (preferred)
- [toBeBold](/matchers/to-be-bold) - bold styling
- [toBeInverse](/matchers/to-be-inverse) - inverse video
- [toHaveUnderline](/matchers/to-have-underline) - underline styling
