---
title: toHaveCursorVisible
description: Assert that the terminal cursor is visible
---

# toHaveCursorVisible

::: warning Deprecated
Prefer [toHaveCursor](/matchers/to-have-cursor) which checks multiple cursor properties at once:
```typescript
expect(term).toHaveCursor({ visible: true })
```
:::

Assert that the terminal cursor is visible.

## Signature

```typescript
expect(term).toHaveCursorVisible(options?: { timeout?: number })
```

## Parameters

| Parameter         | Type     | Description                                 |
| ----------------- | -------- | ------------------------------------------- |
| `options.timeout` | `number` | Auto-retry timeout in ms (Playwright-style) |

## Usage

```typescript
// Assert cursor is visible
expect(term).toHaveCursorVisible()

// With auto-retry
await expect(term).toHaveCursorVisible({ timeout: 5000 })

// Negation
expect(term).not.toHaveCursorVisible()
```

## Accepts

| Target                    | Supported |
| ------------------------- | --------- |
| `term` (TerminalReadable) | Yes       |
| `term.screen`             | No        |
| `term.cell(r, c)`         | No        |

## See Also

- [toHaveCursor](/matchers/to-have-cursor) - composable cursor matcher (preferred)
- [toHaveCursorHidden](/matchers/to-have-cursor-hidden) - assert cursor is hidden
- [toHaveCursorAt](/matchers/to-have-cursor-at) - cursor position
- [toHaveCursorStyle](/matchers/to-have-cursor-style) - cursor shape
