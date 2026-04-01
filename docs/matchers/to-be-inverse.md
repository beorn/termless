---
title: toBeInverse
description: Assert that a terminal cell has inverse (reverse video) styling
---

# toBeInverse

Assert that a cell has inverse video (foreground and background colors swapped).

## Signature

```typescript
expect(cell).toBeInverse()
```

## Usage

```typescript
// Check a specific cell
expect(term.cell(0, 0)).toBeInverse()

// Negation
expect(term.cell(0, 5)).not.toBeInverse()
```

## Accepts

| Region            | Supported |
| ----------------- | --------- |
| `term.cell(r, c)` | Yes       |
| `term.screen`     | No        |
| `term.row(n)`     | No        |

## Notes

- Inverse video (SGR attribute 7) swaps the foreground and background colors
- Commonly used for selections and highlighted text in TUI applications

## See Also

- [toHaveFg](/matchers/to-have-fg) - foreground color assertion
- [toHaveBg](/matchers/to-have-bg) - background color assertion
- [toBeBold](/matchers/to-be-bold) - bold styling
