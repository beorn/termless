---
title: toContainOutput
description: Assert that the raw terminal output stream contains expected bytes
---

# toContainOutput

Assert that the raw terminal output stream contains the given text or protocol bytes.

Use this for bytes that may be consumed by the terminal emulator and never appear in `term.screen`, such as Kitty graphics APC packets, OSC sequences, terminal queries, or CSI mode changes.

## Signature

```typescript
expect(term.out).toContainOutput(text: string, options?: { timeout?: number })
```

## Parameters

| Parameter         | Type     | Description                                 |
| ----------------- | -------- | ------------------------------------------- |
| `text`            | `string` | The substring to search for                 |
| `options.timeout` | `number` | Auto-retry timeout in ms (Playwright-style) |

## Usage

```typescript
// Basic protocol assertion
term.feed("\x1b_Ga=p,i=7;payload\x1b\\")
expect(term.out).toContainOutput("\x1b_Ga=p")

// With auto-retry
await expect(term.out).toContainOutput("\x1b_G", { timeout: 5000 })

// Clear between phases
term.out.clear()
await expect(term.out).toContainOutput("a=d,d=i", { timeout: 5000 })
```

## Accepts

| View       | Supported |
| ---------- | --------- |
| `term.out` | Yes       |

## Notes

- `term.out` is raw output before terminal parsing.
- Prefer `term.screen`, `term.buffer`, `term.row(n)`, and cell/cursor/mode matchers for user-visible behavior.
- When `timeout` is passed, the matcher polls every 50ms until the assertion passes or the timeout expires.

## See Also

- [toContainText](/matchers/to-contain-text) - rendered text in terminal regions
- [Writing Tests](/guide/writing-tests) - lazy views and raw protocol output
