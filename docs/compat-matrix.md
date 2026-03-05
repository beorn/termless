# Cross-Backend Conformance

Cross-backend conformance is now tested via `cross-backend.test.ts` as part of the standard vitest suite. Run with:

```bash
bun vitest run vendor/termless/tests/cross-backend.test.ts --project vendor
```

See `tests/cross-backend.test.ts` for the full test suite covering text rendering, SGR styles, cursor positioning, modes, scrollback, capabilities, key encoding, unicode, and cross-backend output comparison.
