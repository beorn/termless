---
title: toMatchTerminalSnapshot
description: Match terminal content against a Vitest snapshot
---

# toMatchTerminalSnapshot

Match the full terminal state against a Vitest snapshot. Captures text content, cursor position, cursor visibility, cursor style, and screen mode.

## Signature

```typescript
expect(term).toMatchTerminalSnapshot(options?: { name?: string })
```

## Parameters

| Parameter      | Type     | Description            |
| -------------- | -------- | ---------------------- |
| `options.name` | `string` | Optional snapshot name |

## Usage

```typescript
// Basic snapshot
expect(term).toMatchTerminalSnapshot()

// Named snapshot (for multiple snapshots in one test)
expect(term).toMatchTerminalSnapshot({ name: "after-input" })
```

## Snapshot Format

The snapshot includes a header with terminal dimensions and cursor state, followed by numbered rows:

```
# terminal 80x24 | cursor (0,0) visible block
──────────────────────────────────────────────────
 1│Hello, World
 2│
 3│Ready
```

## Accepts

| Target                    | Supported |
| ------------------------- | --------- |
| `term` (TerminalReadable) | Yes       |
| `term.screen`             | No        |
| `term.cell(r, c)`         | No        |

## Notes

- Uses Vitest's built-in snapshot machinery
- Update snapshots with `vitest --update`
- For SVG visual snapshots, use [toMatchSvgSnapshot](/matchers/to-match-svg-snapshot)

## See Also

- [toMatchSvgSnapshot](/matchers/to-match-svg-snapshot) - SVG screenshot snapshot
- [toMatchLines](/matchers/to-match-lines) - assert specific lines without snapshots
