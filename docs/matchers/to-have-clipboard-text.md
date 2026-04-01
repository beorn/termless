---
title: toHaveClipboardText
description: Assert that the terminal has captured specific clipboard text via OSC 52
---

# toHaveClipboardText

Assert that the terminal has captured specific text via OSC 52 clipboard write.

## Signature

```typescript
expect(term).toHaveClipboardText(text: string)
```

## Parameters

| Parameter | Type     | Description             |
| --------- | -------- | ----------------------- |
| `text`    | `string` | Expected clipboard text |

## Usage

```typescript
// Assert clipboard content after an OSC 52 write
expect(term).toHaveClipboardText("copied text")

// Negation
expect(term).not.toHaveClipboardText("wrong text")
```

## Accepts

| Target                                 | Supported |
| -------------------------------------- | --------- |
| `term` (Terminal with clipboardWrites) | Yes       |
| `term.screen`                          | No        |
| `term.cell(r, c)`                      | No        |

## Notes

- This matcher checks the `clipboardWrites` array on the Terminal object
- OSC 52 is the escape sequence terminals use to set clipboard content
- The matcher checks if the text appears in any clipboard write, not just the most recent one
- Does not support auto-retry (no `timeout` option)

## See Also

- [toHaveTitle](/matchers/to-have-title) - terminal title (also set via OSC)
- [toBeInMode](/matchers/to-be-in-mode) - terminal mode assertion
