---
title: toHaveBg
description: Assert that a terminal cell has a specific background color
---

# toHaveBg

::: warning Deprecated
Prefer [toHaveAttrs](/matchers/to-have-attrs) which checks multiple attributes at once:

```typescript
expect(term.cell(0, 0)).toHaveAttrs({ bg: "#282a36" })
```

:::

Assert that a cell has a specific background color. Accepts hex strings or Color objects.

## Signature

```typescript
expect(cell).toHaveBg(color: string | Color)
```

## Parameters

| Parameter | Type              | Description                                    |
| --------- | ----------------- | ---------------------------------------------- |
| `color`   | `string \| Color` | Expected color as `"#rrggbb"` or `{ r, g, b }` |

## Usage

```typescript
// Hex string
expect(term.cell(0, 0)).toHaveBg("#282a36")

// Color object
expect(term.cell(0, 0)).toHaveBg({ r: 40, g: 42, b: 54 })

// Negation
expect(term.cell(0, 0)).not.toHaveBg("#ffffff")
```

## Accepts

| Region            | Supported |
| ----------------- | --------- |
| `term.cell(r, c)` | Yes       |
| `term.screen`     | No        |
| `term.row(n)`     | No        |

## Notes

- Colors are resolved to Color values by the backend
- Palette colors (0-255) are resolved to their Color equivalents
- Default background color depends on the backend's theme

## See Also

- [toHaveAttrs](/matchers/to-have-attrs) - composable attribute matcher (preferred)
- [toHaveFg](/matchers/to-have-fg) - foreground color assertion
- [toBeInverse](/matchers/to-be-inverse) - inverse swaps fg/bg
