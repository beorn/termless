---
title: toHaveUnderline
description: Assert that a terminal cell has underline styling with optional style check
---

# toHaveUnderline

Assert that a cell has underline styling. Optionally check for a specific underline style.

## Signature

```typescript
expect(cell).toHaveUnderline(style?: UnderlineStyle)
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `style` | `UnderlineStyle` | Optional specific style to check |

`UnderlineStyle`: `"single"` | `"double"` | `"curly"` | `"dotted"` | `"dashed"`

## Usage

```typescript
// Any underline
expect(term.cell(0, 0)).toHaveUnderline()

// Specific underline style
expect(term.cell(0, 0)).toHaveUnderline("single")
expect(term.cell(0, 0)).toHaveUnderline("curly")   // spell-check style
expect(term.cell(0, 0)).toHaveUnderline("double")
expect(term.cell(0, 0)).toHaveUnderline("dotted")
expect(term.cell(0, 0)).toHaveUnderline("dashed")

// Negation
expect(term.cell(0, 0)).not.toHaveUnderline()
```

## Accepts

| Region | Supported |
|--------|-----------|
| `term.cell(r, c)` | Yes |
| `term.screen` | No |
| `term.row(n)` | No |

## Notes

- Without a `style` argument, matches any underline style
- Curly underline is commonly used for spell-check indicators
- Not all terminal backends support all underline styles

## See Also

- [toBeBold](/matchers/to-be-bold) - bold styling
- [toBeItalic](/matchers/to-be-italic) - italic styling
- [toBeStrikethrough](/matchers/to-be-strikethrough) - strikethrough styling
