import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Two production-scale cases measured past vitest's 5 s default on the
    // slower CI runners (2026-09-01/02, termless PR #4/#5): the vterm
    // deep-scrollback reflow round-trip at 5.2–5.5 s and the ZIP64
    // 70,000-entry archive round-trip at 6.2 s. A hung test still fails —
    // twenty seconds is a budget for real work, not a tolerance for silence.
    testTimeout: 20_000,
    include: ["tests/**/*.test.ts", "packages/*/tests/**/*.test.ts"],
    exclude: [
      "**/*.slow.test.ts",
      "**/*.slow.spec.ts",
      // Cross-backend and ghostty tests need ghostty-web WASM which requires
      // browser globals (self). Run via km parent: --project vendor
      "tests/cross-backend.test.ts",
      "packages/ghostty/tests/**",
      // rec-live-overlay* import silvery which depends on AsyncDisposableStack
      // (TC39 explicit resource management) — present in Bun but not in
      // Node 22 (it landed in Node 24), and `bun vitest run` spawns Node
      // workers. Run via km parent: --project vendor (which uses Bun).
      "packages/cli/tests/rec-live-overlay.test.ts",
      "packages/cli/tests/rec-live-overlay-pulse.test.ts",
    ],
  },
})
