# termless-cli Tests

**Layer 0 — Platform**: CLI session manager — session lifecycle, text I/O, listing, and error handling.

## What to Test Here

- **Session lifecycle**: `createSession()` with default/custom dimensions, `stopSession()`, `stopAll()`, auto-incrementing session IDs
- **Text I/O**: `feed()` string data, `getText()` read-back via session manager
- **Session management**: `listSessions()` count and metadata, `getSession()` lookup
- **Error paths**: stopping/getting nonexistent sessions throws with session ID in message

## What NOT to Test Here

- Terminal or backend internals — that's termless core and termless-xtermjs
- MCP server protocol handling — requires integration testing with MCP client
- PTY spawning — CLI tests use feed-only mode

## Patterns

```typescript
const manager = createSessionManager()
try {
  const { id, terminal } = await manager.createSession({ cols: 80, rows: 24 })
  terminal.feed("Hello, termless!")
  expect(terminal.getText()).toContain("Hello, termless!")
  expect(manager.listSessions()).toHaveLength(1)
} finally {
  await manager.stopAll()
}
```

## Ad-Hoc Testing

```bash
bun vitest run vendor/beorn-termless/packages/cli/tests/             # All CLI tests
bun vitest run vendor/beorn-termless/packages/cli/tests/ -t "session" # Session tests
```

## Efficiency

Pure in-memory tests (~30ms). Sessions use xterm.js backend but no PTY. Always clean up with `manager.stopAll()` in `finally` blocks.

## See Also

- [Test layering philosophy](../../.claude/skills/tests/test-layers.md)
