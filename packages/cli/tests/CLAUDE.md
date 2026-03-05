# @termless/cli Tests

**Layer 0 -- Platform**: CLI session manager and recording -- session lifecycle, text I/O, frame change detection, HTML slideshow generation.

## What to Test Here

- **Session lifecycle**: `createSession()` with default/custom dimensions, `stopSession()`, `stopAll()`, auto-incrementing session IDs
- **Text I/O**: `feed()` string data, `getText()` read-back via session manager
- **Session management**: `listSessions()` count and metadata, `getSession()` lookup
- **Error paths**: stopping/getting nonexistent sessions throws with session ID in message
- **Frame recording**: `hasFrameChanged()` first-frame detection, content diffing, whitespace sensitivity, multiline content, identical content
- **HTML slideshow**: `generateHtmlSlideshow()` structure (DOCTYPE, script, nav buttons, keyboard hints), frame embedding (SVG inline, frame IDs, visibility), playback config (interval, timestamps, frame count), edge cases (empty frames, single frame, special characters)

## What NOT to Test Here

- Terminal or backend internals -- that's @termless/core and @termless/xtermjs
- MCP server protocol handling -- requires integration testing with MCP client
- PTY spawning -- CLI tests use feed-only mode
- SVG rendering correctness -- that's the root `tests/svg.test.ts`

## Patterns

```typescript
// Session manager
const manager = createSessionManager()
try {
  const { id, terminal } = await manager.createSession({ cols: 80, rows: 24 })
  terminal.feed("Hello, termless!")
  expect(terminal.getText()).toContain("Hello, termless!")
} finally {
  await manager.stopAll()
}

// Frame recording
expect(hasFrameChanged("hello", null)).toBe(true) // First frame always changed
expect(hasFrameChanged("same", "same")).toBe(false) // Identical = no change

// HTML slideshow
const html = generateHtmlSlideshow(frames, 250)
expect(html).toContain("<!DOCTYPE html>")
expect(html).toContain("const interval = 250")
```

## Ad-Hoc Testing

```bash
bun vitest run vendor/termless/packages/cli/tests/              # All CLI tests
bun vitest run vendor/termless/packages/cli/tests/cli.test.ts   # Session manager
bun vitest run vendor/termless/packages/cli/tests/record.test.ts # Frame recording + slideshow
```

## Efficiency

Pure in-memory tests (~30ms). Sessions use xterm.js backend but no PTY. Recording tests are pure string operations. Always clean up with `manager.stopAll()` in `finally` blocks.

## See Also

- [Test layering philosophy](../../.claude/skills/tests/test-layers.md)
