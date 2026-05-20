// Vitest config for running ghostty tests directly (excluded from default).
// Used in CI matrix to verify @napi-rs/canvas + ghostty-web cross-platform.
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
