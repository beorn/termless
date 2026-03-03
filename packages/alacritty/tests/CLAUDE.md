# @termless/alacritty Tests

**Layer 0 -- Platform**: Alacritty backend via napi-rs -- verifies alacritty_terminal's VT parser produces correct cells, colors, styles, cursor, modes, scrollback.

## What to Test Here

- **Text rendering**: plain text, multiline, cursor positioning, line wrapping
- **Cell attributes**: bold, italic, faint, underline (all styles), strikethrough, inverse, truecolor fg/bg, wide characters
- **Cursor**: position tracking after text, newlines, CUP escape sequences, cursor style, visibility
- **Modes**: alt screen, bracketed paste, auto wrap, application cursor, origin mode
- **Scrollback**: state reporting, accumulation
- **Resize**: content preservation after resize
- **Reset**: screen clearing via RIS
- **Key encoding**: Enter, Escape, Ctrl+C, arrows, regular characters
- **Capabilities**: name, truecolor, kitty keyboard support

## What NOT to Test Here

- xterm.js or Ghostty backends -- those are separate packages
- Cross-backend comparison -- that's `tests/cross-backend.test.ts`
- Vitest matchers -- that's viterm

## Patterns

```typescript
import { createAlacrittyBackend } from "../src/backend.ts"
import type { TerminalBackend } from "../../../src/types.ts"

const backend = createAlacrittyBackend()
backend.init({ cols: 80, rows: 24 })
backend.feed(new TextEncoder().encode("\x1b[1mBold\x1b[0m"))
expect(backend.getCell(0, 0).bold).toBe(true)
backend.destroy()
```

## Ad-Hoc Testing

```bash
bun vitest run vendor/beorn-termless/packages/alacritty/tests/ --project vendor
```

## Status

**Requires native module build.** Tests are written but will fail until the Rust native module is compiled. See README.md for build instructions.

## See Also

- [Test layering philosophy](../../.claude/skills/tests/test-layers.md)
- [Cross-backend conformance tests](../../tests/cross-backend.test.ts)
