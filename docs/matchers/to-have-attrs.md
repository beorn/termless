---
title: toHaveAttrs
description: Assert multiple cell attributes at once with partial matching
---

# toHaveAttrs

Assert multiple cell attributes at once. Only specified fields are checked.

## Signature

```typescript
expect(cell).toHaveAttrs(attrs: CellAttrs)
```

## Parameters

| Parameter             | Type                        | Description                           |
| --------------------- | --------------------------- | ------------------------------------- |
| `attrs.bold`          | `boolean`                   | Bold styling                          |
| `attrs.italic`        | `boolean`                   | Italic styling                        |
| `attrs.dim`           | `boolean`                   | Dim/faint styling                     |
| `attrs.strikethrough` | `boolean`                   | Strikethrough styling                 |
| `attrs.inverse`       | `boolean`                   | Inverse/reverse video                 |
| `attrs.wide`          | `boolean`                   | Double-width character                |
| `attrs.underline`     | `boolean \| UnderlineStyle` | `true` = any style, or specific style |
| `attrs.fg`            | `string \| RGB`             | Foreground color (hex or RGB object)  |
| `attrs.bg`            | `string \| RGB`             | Background color (hex or RGB object)  |

All fields are optional. Only specified fields are checked.

## Usage

```typescript
// Single attribute
expect(term.cell(0, 0)).toHaveAttrs({ bold: true })

// Multiple attributes
expect(term.cell(0, 0)).toHaveAttrs({ bold: true, fg: "#ff0000" })

// Underline with specific style
expect(term.cell(5, 3)).toHaveAttrs({ italic: true, underline: "curly" })

// Any underline
expect(term.cell(0, 0)).toHaveAttrs({ underline: true })

// Negation
expect(term.cell(0, 0)).not.toHaveAttrs({ bold: true })
```

## Error Messages

When an assertion fails, the message shows which specific attributes matched and which failed:

```
Expected cell (0,0) containing 'H' to have attrs {"bold":true,"fg":"#ff0000"}
  bold: expected true, got false
  fg: matched
```

## Accepts

| Region            | Supported |
| ----------------- | --------- |
| `term.cell(r, c)` | Yes       |
| `term.screen`     | No        |
| `term.row(n)`     | No        |

## Replaces

This composable matcher replaces 9 individual matchers:

| Old Matcher               | Equivalent                                    |
| ------------------------- | --------------------------------------------- |
| `toBeBold()`              | `toHaveAttrs({ bold: true })`                 |
| `toBeItalic()`            | `toHaveAttrs({ italic: true })`               |
| `toBeDim()`               | `toHaveAttrs({ dim: true })`                  |
| `toBeStrikethrough()`     | `toHaveAttrs({ strikethrough: true })`        |
| `toBeInverse()`           | `toHaveAttrs({ inverse: true })`              |
| `toBeWide()`              | `toHaveAttrs({ wide: true })`                 |
| `toHaveUnderline(style?)` | `toHaveAttrs({ underline: style \|\| true })` |
| `toHaveFg(color)`         | `toHaveAttrs({ fg: color })`                  |
| `toHaveBg(color)`         | `toHaveAttrs({ bg: color })`                  |

The old matchers are deprecated but still work.

## See Also

- [toHaveCursor](/matchers/to-have-cursor) - composable cursor assertions
- [toBeBold](/matchers/to-be-bold) - individual bold assertion (deprecated)
- [toHaveFg](/matchers/to-have-fg) - individual foreground color assertion (deprecated)
