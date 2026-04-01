---
title: toHaveTitle
description: Assert that the terminal has a specific title
---

# toHaveTitle

Assert that the terminal has a specific title, set via OSC 2 escape sequence.

## Signature

```typescript
expect(term).toHaveTitle(title: string, options?: { timeout?: number })
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `title` | `string` | Expected terminal title |
| `options.timeout` | `number` | Auto-retry timeout in ms (Playwright-style) |

## Usage

```typescript
// Check terminal title
expect(term).toHaveTitle("vim - file.txt")

// With auto-retry
await expect(term).toHaveTitle("my-app", { timeout: 5000 })

// Negation
expect(term).not.toHaveTitle("untitled")
```

## Accepts

| Target | Supported |
|--------|-----------|
| `term` (TerminalReadable) | Yes |
| `term.screen` | No |
| `term.cell(r, c)` | No |

## Notes

- Terminal titles are set by applications using the OSC 2 escape sequence
- The title is an exact string match

## See Also

- [toBeInMode](/matchers/to-be-in-mode) - terminal mode assertion
- [toContainText](/matchers/to-contain-text) - screen text assertion
