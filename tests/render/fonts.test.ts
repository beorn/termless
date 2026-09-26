/**
 * @failure  a published @termless/ghostty finds no bundled font and renders a zero-width canvas
 * @level    l1
 * @consumer @termless/ghostty's canvas renderer (npm 0.9.1 shipped this defect; yrd watch captures hit it)
 * @testonly findFontsUpward: exported so the published-layout probe is testable without packing a build
 *
 * Where the bundled fonts are found. In this repository every module sits under the root that holds
 * `assets/fonts`, so the upward probe always succeeds here. A published backend (`@termless/ghostty`)
 * bundles the fonts module into its own `dist/`, where no ancestor holds them; npm's 0.9.1 tarball
 * measured a zero-width cell because of it. These rows pin the probe the published layout depends on.
 */

import { describe, expect, test } from "vitest"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { bundledFontsDir, findFontsUpward } from "../../src/render/fonts.ts"

describe("findFontsUpward", () => {
  test("finds the fonts of an installed @termless/core from its dist entry directory", () => {
    const root = mkdtempSync(join(tmpdir(), "termless-fonts-"))
    try {
      const core = join(root, "node_modules", "@termless", "core")
      mkdirSync(join(core, "assets", "fonts"), { recursive: true })
      mkdirSync(join(core, "dist"), { recursive: true })
      expect(findFontsUpward(join(core, "dist"))).toBe(join(core, "assets", "fonts"))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("finds nothing from a backend's dist that no ancestor supplies fonts to", () => {
    const root = mkdtempSync(join(tmpdir(), "termless-fonts-"))
    try {
      const dist = join(root, "node_modules", "@termless", "ghostty", "dist")
      mkdirSync(dist, { recursive: true })
      expect(findFontsUpward(dist)).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

test("bundledFontsDir resolves the repository's assets/fonts", () => {
  expect(bundledFontsDir()).toBe(join(import.meta.dirname, "..", "..", "assets", "fonts"))
})
