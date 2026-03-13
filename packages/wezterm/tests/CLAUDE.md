# @termless/wezterm Tests

**Layer 0 — Platform**: WezTerm backend via napi-rs native bindings — verifies wezterm-term's VT parser produces correct cells, colors, styles, cursor, modes, scrollback.

## What to Test Here

- **Text rendering**: plain text, multiline, cursor positioning, line wrapping
- **Cell attributes**: bold, italic, dim, underline (all styles), strikethrough, inverse, truecolor fg/bg, wide characters
- **Cursor**: position tracking after text, newlines, CUP escape sequences
- **Modes**: alt screen, bracketed paste, auto wrap, application cursor
- **Scrollback**: state reporting, accumulation
- **Resize**: content preservation after resize
- **Reset**: screen clearing via RIS
- **Key encoding**: Enter, Escape, Ctrl+C, arrows, regular characters
- **Capabilities**: name, truecolor, kitty keyboard support, sixel

## What NOT to Test Here

- xterm.js backend — that's @termless/xtermjs
- Ghostty backend — that's @termless/ghostty
- Cross-backend comparison — that's `tests/cross-backend.test.ts`
- Vitest matchers — that's @termless/test

## Patterns

```typescript
import { createWeztermBackend, loadWeztermNative } from "../src/backend.ts"

// Native module must be loaded first
beforeAll(() => {
  loadWeztermNative()
})

const backend = createWeztermBackend()
backend.init({ cols: 80, rows: 24 })
backend.feed(new TextEncoder().encode("\x1b[1mBold\x1b[0m"))
expect(backend.getCell(0, 0).bold).toBe(true)
backend.destroy()
```

## Prerequisites

The native Rust module must be compiled before running tests:

```bash
cd packages/wezterm/native && cargo build --release
cp target/release/libtermless_wezterm_native.dylib ../termless-wezterm.node
```

## Ad-Hoc Testing

```bash
bun vitest run packages/wezterm/tests/
```

## See Also

- [Test layering philosophy](../../.claude/skills/tests/test-layers.md)
- [Cross-backend conformance tests](../../tests/cross-backend.test.ts)
