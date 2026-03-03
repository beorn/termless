# termless-ghostty Tests

**Layer 0 — Platform**: Ghostty backend stub — verifies not-yet-implemented error and fallback guidance.

## What to Test Here

- **Stub behavior**: `createGhosttyBackend()` throws "not yet implemented" error
- **Error message**: suggests `termless-xtermjs` as fallback

## What NOT to Test Here

- Actual Ghostty VT parsing — not implemented yet (Phase 2: libghostty-vt Zig + napigen N-API)
- xterm.js backend — that's termless-xtermjs

## Patterns

```typescript
expect(() => createGhosttyBackend()).toThrow("not yet implemented")
expect(() => createGhosttyBackend()).toThrow("termless-xtermjs")
```

## Ad-Hoc Testing

```bash
bun vitest run vendor/beorn-termless/packages/ghostty/tests/  # Ghostty stub tests
```

## Efficiency

Instant (~5ms). Pure synchronous throw checks, no backend initialization.

## See Also

- [Test layering philosophy](../../.claude/skills/tests/test-layers.md)
