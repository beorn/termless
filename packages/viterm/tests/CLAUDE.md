# @termless/test Tests

**Layer 0 -- Platform**: Vitest integration for terminal testing -- custom matchers, auto-cleanup fixtures, and snapshot serializer.

## What to Test Here

- **Text matchers (RegionView)**: `toContainText`, `toHaveText`, `toMatchLines`
- **Cell style matchers (CellView)**: `toBeBold`, `toBeItalic`, `toBeFaint`, `toBeStrikethrough`, `toBeInverse`, `toBeWide`, `toHaveUnderline` (with style), `toHaveFg`/`toHaveBg` (hex + RGB)
- **Terminal matchers (TerminalReadable)**: `toHaveCursorAt`/`toHaveCursorVisible`/`toHaveCursorHidden`/`toHaveCursorStyle`, `toBeInMode`, `toHaveTitle`, `toHaveScrollbackLines`/`toBeAtBottomOfScrollback`, `toMatchTerminalSnapshot`
- **Matcher edge cases**: `.not` negation, wrong-type error handling (passing TerminalReadable to a RegionView matcher, passing string/null/plain object)
- **Fixtures**: `createTerminalFixture()` returns valid Terminal interface, delegates to backend, accepts string and Uint8Array feed, auto-cleanup via afterEach
- **Serializer**: `terminalSnapshot()` marker creation, `terminalSerializer.test()` identification, `serialize()` output format (header, dimensions, cursor, line numbers, separator, style annotations, altScreen mode, custom name, hidden cursor)

## What NOT to Test Here

- Actual terminal rendering -- matchers test against mock `TerminalReadable` / `RegionView` / `CellView`, not real backends
- xterm.js or Ghostty backend behavior -- that's their own test directories
- Full-stack integration -- that's the root `tests/` directory

## Helpers

- `createMockTerminal()` (in each test file): factory for mock `TerminalReadable` with lines, cell overrides, cursor, modes, title, and scrollback options
- `createMockBackend()` (in `fixture.test.ts`): minimal `TerminalBackend` for fixture tests

## Patterns

```typescript
// Text matcher tests use mock RegionView
const region = {
  getText: () => "Hello World",
  getLines: () => ["Hello World"],
  containsText: (t) => "Hello World".includes(t),
}
expect(region).toContainText("Hello")
expect(region).toHaveText("Hello World")

// Cell style matcher tests use mock CellView
const cell = {
  text: "H",
  row: 0,
  col: 0,
  bold: true,
  faint: false,
  italic: false,
  underline: "none",
  strikethrough: false,
  inverse: false,
  wide: false,
  fg: { r: 255, g: 0, b: 0 },
  bg: null,
}
expect(cell).toBeBold()
expect(cell).toHaveFg("#ff0000")

// Terminal matchers use mock TerminalReadable
const term = createMockTerminal({
  lines: ["Hello World"],
  cursor: { x: 5, y: 0, visible: true, style: "block" },
})
expect(term).toHaveCursorAt(5, 0)
expect(term).toBeInMode("altScreen")

// Serializer tests
const marker = terminalSnapshot(term, "step-1")
expect(terminalSerializer.test(marker)).toBe(true)
const output = terminalSerializer.serialize(marker)
expect(output).toContain("terminal 11x1")
```

## Ad-Hoc Testing

```bash
bun vitest run vendor/termless/packages/viterm/tests/                   # All @termless/test tests
bun vitest run vendor/termless/packages/viterm/tests/matchers.test.ts   # Matcher pass/fail
bun vitest run vendor/termless/packages/viterm/tests/fixture.test.ts    # Fixture auto-cleanup
bun vitest run vendor/termless/packages/viterm/tests/serializer.test.ts # Snapshot format
```

## Efficiency

Pure in-memory tests (~20ms). No I/O, no WASM, no real terminal. Mock factories are inlined per test file.

## See Also

- [Test layering philosophy](../../.claude/skills/tests/test-layers.md)
