---
title: toHaveFg
description: Assert that a terminal cell has a specific foreground color
---

# toHaveFg

::: warning Deprecated
Prefer [toHaveAttrs](/matchers/to-have-attrs) which checks multiple attributes at once:

```typescript
expect(term.cell(0, 0)).toHaveAttrs({ fg: "#ff0000" })
```

:::

Assert that a cell has a specific foreground color. Accepts hex strings or RGB objects.

## Signature

```typescript
expect(cell).toHaveFg(color: string | RGB)
```

## Parameters

| Parameter | Type            | Description                                    |
| --------- | --------------- | ---------------------------------------------- |
| `color`   | `string \| RGB` | Expected color as `"#rrggbb"` or `{ r, g, b }` |

## Usage

```typescript
// Hex string
expect(term.cell(0, 0)).toHaveFg("#ff0000")

// RGB object
expect(term.cell(0, 0)).toHaveFg({ r: 255, g: 0, b: 0 })

// Negation
expect(term.cell(0, 0)).not.toHaveFg("#000000")
```

## Accepts

| Region            | Supported |
| ----------------- | --------- |
| `term.cell(r, c)` | Yes       |
| `term.screen`     | No        |
| `term.row(n)`     | No        |

## Notes

- Colors are resolved to RGB values by the backend
- Palette colors (0-255) are resolved to their RGB equivalents
- Default foreground color depends on the backend's theme

## See Also

- [toHaveAttrs](/matchers/to-have-attrs) - composable attribute matcher (preferred)
- [toHaveBg](/matchers/to-have-bg) - background color assertion
- [toBeBold](/matchers/to-be-bold) - bold (which may affect color brightness)
- [toBeInverse](/matchers/to-be-inverse) - inverse swaps fg/bg
