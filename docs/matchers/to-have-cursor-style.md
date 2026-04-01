---
title: toHaveCursorStyle
description: Assert that the terminal cursor has a specific shape
---

# toHaveCursorStyle

::: warning Deprecated
Prefer [toHaveCursor](/matchers/to-have-cursor) which checks multiple cursor properties at once:
```typescript
expect(term).toHaveCursor({ style: "block" })
```
:::

Assert that the terminal cursor has a specific style (shape).

## Signature

```typescript
expect(term).toHaveCursorStyle(style: CursorStyle, options?: { timeout?: number })
```

## Parameters

| Parameter         | Type          | Description                                 |
| ----------------- | ------------- | ------------------------------------------- |
| `style`           | `CursorStyle` | Expected cursor style                       |
| `options.timeout` | `number`      | Auto-retry timeout in ms (Playwright-style) |

`CursorStyle`: `"block"` | `"underline"` | `"beam"`

## Usage

```typescript
// Block cursor (default for most terminals)
expect(term).toHaveCursorStyle("block")

// Beam cursor (common in insert mode)
expect(term).toHaveCursorStyle("beam")

// Underline cursor
expect(term).toHaveCursorStyle("underline")

// With auto-retry
await expect(term).toHaveCursorStyle("beam", { timeout: 5000 })
```

## Accepts

| Target                    | Supported |
| ------------------------- | --------- |
| `term` (TerminalReadable) | Yes       |
| `term.screen`             | No        |
| `term.cell(r, c)`         | No        |

## See Also

- [toHaveCursor](/matchers/to-have-cursor) - composable cursor matcher (preferred)
- [toHaveCursorAt](/matchers/to-have-cursor-at) - cursor position
- [toHaveCursorVisible](/matchers/to-have-cursor-visible) - cursor visibility
