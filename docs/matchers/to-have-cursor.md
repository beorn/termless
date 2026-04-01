---
title: toHaveCursor
description: Assert multiple cursor properties at once with partial matching
---

# toHaveCursor

Assert multiple cursor properties at once. Only specified fields are checked.

## Signature

```typescript
expect(term).toHaveCursor(props: CursorProps, options?: { timeout?: number })
```

## Parameters

| Parameter         | Type                               | Description                                 |
| ----------------- | ---------------------------------- | ------------------------------------------- |
| `props.x`         | `number`                           | Column (0-based)                            |
| `props.y`         | `number`                           | Row (0-based)                               |
| `props.visible`   | `boolean`                          | Whether cursor is visible                   |
| `props.style`     | `"block" \| "underline" \| "beam"` | Cursor shape                                |
| `options.timeout` | `number`                           | Auto-retry timeout in ms (Playwright-style) |

All `props` fields are optional. Only specified fields are checked.

## Usage

```typescript
// Position only
expect(term).toHaveCursor({ x: 5, y: 10 })

// Visibility and style
expect(term).toHaveCursor({ visible: true, style: "block" })

// All properties
expect(term).toHaveCursor({ x: 0, y: 0, visible: true, style: "beam" })

// With auto-retry
await expect(term).toHaveCursor({ x: 5, y: 10 }, { timeout: 5000 })

// Negation
expect(term).not.toHaveCursor({ visible: false })
```

## Error Messages

When an assertion fails, the message shows which specific properties matched and which failed:

```
Expected terminal to have cursor {"x":5,"y":10,"visible":true}
  x: expected 5, got 3
  y: matched
  visible: matched
```

## Accepts

| Target                    | Supported |
| ------------------------- | --------- |
| `term` (TerminalReadable) | Yes       |
| `term.screen`             | No        |
| `term.cell(r, c)`         | No        |

## Replaces

This composable matcher replaces 4 individual matchers:

| Old Matcher             | Equivalent                         |
| ----------------------- | ---------------------------------- |
| `toHaveCursorAt(x, y)`  | `toHaveCursor({ x, y })`           |
| `toHaveCursorStyle(s)`  | `toHaveCursor({ style: s })`       |
| `toHaveCursorVisible()` | `toHaveCursor({ visible: true })`  |
| `toHaveCursorHidden()`  | `toHaveCursor({ visible: false })` |

The old matchers are deprecated but still work.

## See Also

- [toHaveAttrs](/matchers/to-have-attrs) - composable cell attribute assertions
- [toHaveCursorAt](/matchers/to-have-cursor-at) - individual position assertion (deprecated)
- [toHaveCursorStyle](/matchers/to-have-cursor-style) - individual style assertion (deprecated)
