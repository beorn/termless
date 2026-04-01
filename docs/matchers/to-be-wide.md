---
title: toBeWide
description: Assert that a terminal cell contains a double-width character
---

# toBeWide

Assert that a cell contains a double-width (wide) character, such as CJK characters or certain emoji.

## Signature

```typescript
expect(cell).toBeWide()
```

## Usage

```typescript
// CJK character occupies two columns
expect(term.cell(0, 0)).toBeWide()

// ASCII characters are not wide
expect(term.cell(0, 0)).not.toBeWide()
```

## Accepts

| Region | Supported |
|--------|-----------|
| `term.cell(r, c)` | Yes |
| `term.screen` | No |
| `term.row(n)` | No |

## Notes

- Wide characters occupy two terminal columns
- The first cell of a wide character has `toBeWide()` true; the second cell is a continuation cell
- Common wide characters: CJK ideographs, fullwidth forms, some emoji

## See Also

- [toBeBold](/matchers/to-be-bold) - bold styling
- [toHaveText](/matchers/to-have-text) - text content assertion
