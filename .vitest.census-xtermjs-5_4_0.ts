import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@xterm/headless": "/Users/beorn/Code/pim/km/vendor/termless/.termless-cache/census-versions/_xterm_headless-5.4.0/node_modules/@xterm/headless/lib-headless/xterm-headless.js",
    },
  },
  test: {
    include: ["packages/census/probes/**/*.probe.ts"],
  },
})