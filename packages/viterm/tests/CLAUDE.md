# viterm Tests

**Layer 0 — Platform**: Vitest integration for terminal testing — custom matchers, auto-cleanup fixtures, and snapshot serializer.

## What to Test Here

- **Matchers**: `toContainText`, `toHaveTextAt`, `toContainTextInRow`, `toHaveEmptyRow`, `toHaveFgColor`/`toHaveBgColor` (hex + RGB), `toBeBoldAt`/`toBeItalicAt`/`toBeFaintAt`/`toBeInverseAt`/`toBeWideAt`/`toBeStrikethroughAt`, `toHaveUnderlineAt` (with style), `toHaveCursorAt`/`toHaveCursorVisible`/`toHaveCursorHidden`/`toHaveCursorStyle`, `toBeInAltScreen`/`toBeInBracketedPaste`/`toHaveMode`, `toHaveTitle`, `toHaveScrollbackLines`/`toBeAtBottomOfScrollback`
- **Matcher edge cases**: `.not` negation, non-TerminalReadable error handling (string, null, plain object)
- **Fixtures**: `createTerminalFixture()` returns valid Terminal interface, delegates to backend, accepts string and Uint8Array feed, auto-cleanup via afterEach
- **Serializer**: `terminalSnapshot()` marker creation, `terminalSerializer.test()` identification, `serialize()` output format (header, dimensions, cursor, line numbers, separator, style annotations, altScreen mode, custom name, hidden cursor)

## What NOT to Test Here

- Actual terminal rendering — matchers test against mock `TerminalReadable`, not real backends
- xterm.js or Ghostty backend behavior — that's their own test directories
- Full-stack integration — that's the root `tests/` directory

## Helpers

- `createMockTerminal()` (in each test file): factory for mock `TerminalReadable` with lines, cell overrides, cursor, modes, title, and scrollback options
- `createMockBackend()` (in `fixture.test.ts`): minimal `TerminalBackend` for fixture tests

## Patterns

```typescript
// Matcher tests use mock TerminalReadable
const term = createMockTerminal({
  lines: ["Hello World"],
  cells: new Map([["0,0", { bold: true, fg: { r: 255, g: 0, b: 0 } }]]),
  cursor: { x: 5, y: 0, visible: true, style: "block" },
  modes: { altScreen: true },
})
expect(term).toContainText("Hello")
expect(term).toBeBoldAt(0, 0)
expect(term).toHaveFgColor(0, 0, "#ff0000")

// Serializer tests
const marker = terminalSnapshot(term, "step-1")
expect(terminalSerializer.test(marker)).toBe(true)
const output = terminalSerializer.serialize(marker)
expect(output).toContain("terminal 11x1")
```

## Ad-Hoc Testing

```bash
bun vitest run vendor/beorn-termless/packages/viterm/tests/                   # All viterm tests
bun vitest run vendor/beorn-termless/packages/viterm/tests/matchers.test.ts   # Matcher pass/fail
bun vitest run vendor/beorn-termless/packages/viterm/tests/fixture.test.ts    # Fixture auto-cleanup
bun vitest run vendor/beorn-termless/packages/viterm/tests/serializer.test.ts # Snapshot format
```

## Efficiency

Pure in-memory tests (~20ms). No I/O, no WASM, no real terminal. Mock factories are inlined per test file.

## See Also

- [Test layering philosophy](../../.claude/skills/tests/test-layers.md)
