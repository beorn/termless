import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "packages/*/tests/**/*.test.ts"],
    exclude: [
      "**/*.slow.test.ts",
      "**/*.slow.spec.ts",
      // Cross-backend and ghostty tests need ghostty-web WASM which requires
      // browser globals (self). Run via km parent: --project vendor
      "tests/cross-backend.test.ts",
      "packages/ghostty/tests/**",
      // rec-live-overlay imports silvery which depends on AsyncDisposableStack
      // (TC39 explicit resource management) — present in Bun but not in
      // Node 22. Run via km parent: --project vendor (which uses Bun).
      "packages/cli/tests/rec-live-overlay.test.ts",
    ],
  },
})
