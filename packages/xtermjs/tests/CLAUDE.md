# @termless/xtermjs Tests

**Layer 0 -- Platform**: xterm.js headless backend correctness -- ANSI parsing, cell attributes, cursor tracking, terminal modes, and key encoding.

## What to Test Here

- **Lifecycle**: `createXtermBackend()` creation with default/custom dimensions, eager init via opts, `destroy()`
- **Text I/O**: `feed()` plain and multiline text, `getText()` read-back, `getTextRange()` substrings
- **Colors**: ANSI 16-color (SGR 31, 42), 256-color (SGR 38;5;N), truecolor 24-bit (SGR 38;2;R;G;B), foreground and background
- **Attributes**: bold, italic, underline (single), strikethrough, faint/dim, inverse, combined attributes (bold + color)
- **Wide characters**: CJK double-width cells, spacer cell after wide char
- **Cursor**: position tracking after feed, newline movement, default style (block)
- **Modes**: alt screen (`?1049h/l`), bracketed paste (`?2004h`), mouse tracking (`?1000h`)
- **Key encoding**: `encodeKey()` for arrows, Ctrl+letter, Alt+letter, Shift+Arrow, Ctrl+Shift+Arrow, regular chars, Enter, function keys
- **Other**: `resize()`, `reset()`, `getLine()`/`getLines()`, `getScrollback()`, title via OSC 2, capabilities, backend name, default cell

## What NOT to Test Here

- Terminal API (`createTerminal`) and region views -- that's the root `tests/` directory
- Cross-backend comparison -- that's `tests/cross-backend.test.ts`
- Vitest matchers/serializer -- that's @termless/test
- Ghostty backend -- that's the ghostty package

## Patterns

```typescript
const backend = createXtermBackend({ cols: 80, rows: 24 })
backend.feed(new TextEncoder().encode("\x1b[1;31mBold Red\x1b[0m"))
const cell = backend.getCell(0, 0)
expect(cell.bold).toBe(true)
expect(cell.fg!.r).toBe(0x80)
backend.destroy()
```

## Ad-Hoc Testing

```bash
bun vitest run packages/xtermjs/tests/              # All xtermjs tests
bun vitest run packages/xtermjs/tests/ -t "color"   # Color-related tests
bun vitest run packages/xtermjs/tests/ -t "encode"  # Key encoding tests
```

## Efficiency

Tests use xterm.js headless WASM backend (~50ms setup). Each test creates and destroys its own backend instance. No PTY, no real terminal.

## See Also

- [Test layering philosophy](../../.claude/skills/tests/test-layers.md)
- [Cross-backend conformance tests](../../tests/cross-backend.test.ts)
