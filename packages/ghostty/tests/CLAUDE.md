# @termless/ghostty Tests

**Layer 0 — Platform**: Ghostty backend via WASM — verifies Ghostty's VT parser produces correct cells, colors, styles, cursor, modes, scrollback.

## What to Test Here

- **Text rendering**: plain text, multiline, cursor positioning, line wrapping
- **Cell attributes**: bold, italic, faint, underline, strikethrough, inverse, truecolor fg/bg, wide characters
- **Cursor**: position tracking after text, newlines, CUP escape sequences
- **Modes**: alt screen, bracketed paste, auto wrap
- **Scrollback**: state reporting, accumulation
- **Resize**: content preservation after resize
- **Reset**: screen clearing via RIS
- **Key encoding**: Enter, Escape, Ctrl+C, arrows, regular characters
- **Capabilities**: name, truecolor, kitty keyboard support

## What NOT to Test Here

- xterm.js backend — that's @termless/xtermjs
- Cross-backend comparison — that's `tests/cross-backend.test.ts`
- Vitest matchers — that's @termless/test

## Patterns

```typescript
import { Ghostty } from "ghostty-web"
import { createGhosttyBackend, initGhostty } from "../src/backend.ts"

let ghostty: Ghostty
beforeAll(async () => {
  ghostty = await initGhostty()
})

const backend = createGhosttyBackend(undefined, ghostty)
backend.init({ cols: 80, rows: 24 })
backend.feed(new TextEncoder().encode("\x1b[1mBold\x1b[0m"))
expect(backend.getCell(0, 0).bold).toBe(true)
backend.destroy()
```

## Ad-Hoc Testing

```bash
bun vitest run vendor/termless/packages/ghostty/tests/ --project vendor
```

## Efficiency

~85ms for 35 tests. WASM init is async (~50ms first time, cached after). Cell operations are fast (single WASM call for viewport).

## See Also

- [Test layering philosophy](../../.claude/skills/tests/test-layers.md)
- [Cross-backend conformance tests](../../tests/cross-backend.test.ts)
