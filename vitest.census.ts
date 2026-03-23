import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["packages/census/probes/**/*.probe.ts"],
  },
})
