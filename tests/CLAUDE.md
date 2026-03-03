# termless Tests

**Layer 0 -- Platform**: Core terminal API, key mapping, SVG screenshot rendering, region views, and full-stack integration.

## What to Test Here

- **Key mapping**: `parseKey()` string->descriptor, `keyToAnsi()` descriptor->ANSI sequences, modifiers (Ctrl, Alt, Shift, Meta/Cmd), named keys (arrows, function keys, Home/End)
- **Terminal API**: `createTerminal()` lifecycle (init, feed, resize, close, `Symbol.asyncDispose`), region selectors (`screen`, `scrollback`, `buffer`, `viewport`, `row(n)`, `cell(r, c)`, `range(r1, c1, r2, c2)`, `firstRow()`, `lastRow()`), text search (`find`, `findAll`), cursor/cell delegation, `waitFor`/`waitForStable`, PTY-less error paths
- **Region views**: `RegionView` (getText, getLines, containsText), `CellView` (positional cell with style), `RowView` (extends RegionView with row number and cellAt)
- **SVG rendering**: `screenshotSvg()` output validity, cell styling (bold, italic, faint, fg/bg color, inverse, underline, strikethrough), cursor styles (block, beam, underline), custom themes/fonts, XML escaping, dimension calculation, bg-rect merging
- **Integration**: Terminal + XtermBackend + @termless/test matchers + snapshot serializer wired together end-to-end
- **Cross-backend**: xterm.js vs Ghostty vs vt100 conformance (`cross-backend.test.ts`) — same input sequences, cell-by-cell comparison. Covers text rendering, SGR styles, cursor, modes, wide characters, underlines, scrollback, capabilities, key encoding, and cross-backend output comparison.

## What NOT to Test Here

- xterm.js backend internals -- that's @termless/xtermjs
- Vitest matcher logic in isolation -- that's @termless/test
- CLI/MCP server behavior -- that's @termless/cli
- PTY spawning (requires real shell) -- integration tests use feed-only mode

## Helpers

- `createMockBackend()` (in `terminal.test.ts`): minimal in-memory `TerminalBackend` for testing Terminal API without xterm.js
- `createMockReadable()` (in `svg.test.ts`): mock `TerminalReadable` with cell overrides for SVG renderer tests
- `createXterm()` (in `integration.test.ts`): shorthand for `createTerminal({ backend: createXtermBackend() })`

## Patterns

```typescript
// Terminal API with mock backend + region selectors
const backend = createMockBackend()
const term = createTerminal({ backend, cols: 40, rows: 10 })
term.feed("Hello")
expect(term.screen).toContainText("Hello")
expect(term.row(0)).toHaveText("Hello")
expect(term.cell(0, 0)).toBeBold()
term.close()

// SVG with cell overrides
const readable = createMockReadable(["ab"], {
  cellOverrides: { "0,0": { bold: true, fg: { r: 255, g: 0, b: 0 } } },
})
const svg = screenshotSvg(readable)
expect(svg).toContain('font-weight="bold"')

// Integration: real xterm backend + region selectors + viterm matchers
const term = createXterm()
term.feed("\x1b[31mRed\x1b[0m")
expect(term.screen).toContainText("Red")
expect(term.cell(0, 0)).toHaveFg("#ff0000")
```

## Ad-Hoc Testing

```bash
bun vitest run vendor/beorn-termless/tests/                    # All root tests
bun vitest run vendor/beorn-termless/tests/terminal.test.ts    # Key mapping + Terminal API
bun vitest run vendor/beorn-termless/tests/svg.test.ts         # SVG screenshot renderer
bun vitest run vendor/beorn-termless/tests/integration.test.ts # Full-stack integration
bun vitest run vendor/beorn-termless/tests/cross-backend.test.ts --project vendor # Cross-backend conformance
```

## Efficiency

Mock backend tests (~30ms) are pure in-memory. Integration tests with xterm.js (~100ms) are heavier due to WASM backend. SVG tests are string-only -- no I/O.

## See Also

- [Test layering philosophy](../../.claude/skills/tests/test-layers.md)
- [Cross-backend conformance tests](cross-backend.test.ts)
