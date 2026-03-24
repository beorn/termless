# @termless/vterm Tests

**Layer 0 -- Platform**: vterm.js backend correctness — ANSI parsing, cell attributes, cursor tracking, terminal modes, and key encoding.

## What to Test Here

- **Lifecycle**: `createVtermBackend()` creation, eager init, `destroy()`
- **Text I/O**: `feed()` + `getText()` + `getTextRange()`
- **Colors**: 16/256/truecolor fg + bg
- **Attributes**: bold, italic, underline (all styles), strikethrough, dim, inverse, blink, underline color
- **Wide characters**: CJK double-width cells
- **Cursor**: position, visibility, shape (block/underline/bar)
- **Modes**: alt screen, bracketed paste, mouse tracking, synchronized output
- **Hyperlinks**: OSC 8 hyperlink support
- **Key encoding**: `encodeKey()` for arrows, modifiers

## What NOT to Test Here

- Terminal API and region views — root `tests/`
- Cross-backend comparison — `tests/cross-backend.test.ts`
- Vitest matchers — @termless/test
- Other backends — their own packages
