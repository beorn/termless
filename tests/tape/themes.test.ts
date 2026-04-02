/**
 * Tests for built-in recording themes.
 */

import { describe, test, expect } from "vitest"
import { resolveTheme, listThemes, listAliases } from "../../src/tape/themes.ts"

// =============================================================================
// resolveTheme
// =============================================================================

describe("resolveTheme", () => {
  test("returns correct colors for known themes", () => {
    const dracula = resolveTheme("dracula")
    expect(dracula).toBeDefined()
    expect(dracula!.background).toBe("#282a36")
    expect(dracula!.foreground).toBe("#f8f8f2")
    expect(dracula!.cursor).toBe("#f8f8f2")
  })

  test("includes ANSI palette colors", () => {
    const dracula = resolveTheme("dracula")
    expect(dracula!.palette).toBeDefined()
    expect(dracula!.palette![0]).toBe("#21222c")
    expect(dracula!.palette![1]).toBe("#ff5555")
    // palette[15] is brightWhite — exact value depends on whether @silvery/theme
    // is available (silvery uses #f8f8f2, built-in fallback uses #ffffff)
    expect(dracula!.palette![15]).toMatch(/^#[0-9a-f]{6}$/i)
  })

  test("case insensitive lookup", () => {
    const upper = resolveTheme("Dracula")
    const mixed = resolveTheme("DRACULA")
    const lower = resolveTheme("dracula")
    expect(upper).toEqual(lower)
    expect(mixed).toEqual(lower)
  })

  test("aliases resolve to canonical themes", () => {
    const catppuccin = resolveTheme("catppuccin")
    const catppuccinMocha = resolveTheme("catppuccin-mocha")
    expect(catppuccin).toEqual(catppuccinMocha)
    expect(catppuccin).toBeDefined()

    const solarized = resolveTheme("solarized")
    const solarizedDark = resolveTheme("solarized-dark")
    expect(solarized).toEqual(solarizedDark)

    const gruvbox = resolveTheme("gruvbox")
    const gruvboxDark = resolveTheme("gruvbox-dark")
    expect(gruvbox).toEqual(gruvboxDark)

    const github = resolveTheme("github")
    const githubDark = resolveTheme("github-dark")
    expect(github).toEqual(githubDark)
  })

  test("case insensitive aliases", () => {
    const catppuccin = resolveTheme("Catppuccin")
    expect(catppuccin).toBeDefined()
    expect(catppuccin!.background).toBe("#1e1e2e")
  })

  test("unknown theme returns undefined", () => {
    expect(resolveTheme("nonexistent-theme")).toBeUndefined()
    expect(resolveTheme("")).toBeUndefined()
  })
})

// =============================================================================
// listThemes
// =============================================================================

describe("listThemes", () => {
  test("returns all theme names", () => {
    const themes = listThemes()
    expect(themes.length).toBeGreaterThanOrEqual(12)
    expect(themes).toContain("dracula")
    expect(themes).toContain("nord")
    expect(themes).toContain("monokai")
    expect(themes).toContain("catppuccin-mocha")
    expect(themes).toContain("tokyo-night")
    expect(themes).toContain("solarized-dark")
    expect(themes).toContain("solarized-light")
    expect(themes).toContain("github-dark")
    expect(themes).toContain("github-light")
    expect(themes).toContain("gruvbox-dark")
    expect(themes).toContain("one-dark")
    expect(themes).toContain("rose-pine")
  })

  test("does not include aliases", () => {
    const themes = listThemes()
    expect(themes).not.toContain("catppuccin")
    expect(themes).not.toContain("solarized")
    expect(themes).not.toContain("gruvbox")
    expect(themes).not.toContain("github")
  })
})

// =============================================================================
// listAliases
// =============================================================================

describe("listAliases", () => {
  test("returns alias pairs", () => {
    const aliases = listAliases()
    expect(aliases.length).toBeGreaterThanOrEqual(4)
    expect(aliases).toContainEqual(["catppuccin", "catppuccin-mocha"])
    expect(aliases).toContainEqual(["solarized", "solarized-dark"])
    expect(aliases).toContainEqual(["gruvbox", "gruvbox-dark"])
    expect(aliases).toContainEqual(["github", "github-dark"])
  })
})

// =============================================================================
// All themes are well-formed
// =============================================================================

describe("theme integrity", () => {
  test("every theme has foreground, background, and cursor", () => {
    for (const name of listThemes()) {
      const theme = resolveTheme(name)
      expect(theme, `theme "${name}" should exist`).toBeDefined()
      expect(theme!.foreground, `${name}.foreground`).toMatch(/^#[0-9a-f]{6}$/i)
      expect(theme!.background, `${name}.background`).toMatch(/^#[0-9a-f]{6}$/i)
      expect(theme!.cursor, `${name}.cursor`).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  test("every theme has a 16-color ANSI palette", () => {
    for (const name of listThemes()) {
      const theme = resolveTheme(name)!
      expect(theme.palette, `${name} should have palette`).toBeDefined()
      for (let i = 0; i < 16; i++) {
        expect(theme.palette![i], `${name}.palette[${i}]`).toMatch(/^#[0-9a-f]{6}$/i)
      }
    }
  })
})

// =============================================================================
// Silvery theme integration
// =============================================================================

describe("silvery theme integration", () => {
  test("includes silvery palettes (45+ themes when @silvery/theme is available)", () => {
    const themes = listThemes()
    // When @silvery/theme is available (as in the km monorepo), we get 45+ palettes
    expect(themes.length).toBeGreaterThanOrEqual(40)
  })

  test("resolves silvery-only themes not in built-in set", () => {
    // These are only in @silvery/theme, not in the built-in 12
    const kanagawa = resolveTheme("kanagawa-wave")
    expect(kanagawa).toBeDefined()
    expect(kanagawa!.foreground).toMatch(/^#[0-9a-f]{6}$/i)
    expect(kanagawa!.background).toMatch(/^#[0-9a-f]{6}$/i)

    const everforest = resolveTheme("everforest-dark")
    expect(everforest).toBeDefined()

    const nightfox = resolveTheme("nightfox")
    expect(nightfox).toBeDefined()

    const snazzy = resolveTheme("snazzy")
    expect(snazzy).toBeDefined()
  })

  test("silvery theme aliases resolve correctly", () => {
    const kanagawa = resolveTheme("kanagawa")
    const kanagawaWave = resolveTheme("kanagawa-wave")
    expect(kanagawa).toEqual(kanagawaWave)

    const material = resolveTheme("material")
    const materialDark = resolveTheme("material-dark")
    expect(material).toEqual(materialDark)

    const everforest = resolveTheme("everforest")
    const everforestDark = resolveTheme("everforest-dark")
    expect(everforest).toEqual(everforestDark)
  })

  test("silvery themes have lowercase hex colors in palette", () => {
    // Verify the paletteToSvgTheme normalization
    const dracula = resolveTheme("dracula")!
    expect(dracula.palette![0]).toMatch(/^#[0-9a-f]{6}$/)
    expect(dracula.background).toMatch(/^#[0-9a-f]{6}$/)
    expect(dracula.foreground).toMatch(/^#[0-9a-f]{6}$/)
  })

  test("all catppuccin variants are available", () => {
    for (const variant of ["catppuccin-mocha", "catppuccin-frappe", "catppuccin-macchiato", "catppuccin-latte"]) {
      const theme = resolveTheme(variant)
      expect(theme, `${variant} should be available`).toBeDefined()
    }
  })

  test("all rose-pine variants are available", () => {
    for (const variant of ["rose-pine", "rose-pine-moon", "rose-pine-dawn"]) {
      const theme = resolveTheme(variant)
      expect(theme, `${variant} should be available`).toBeDefined()
    }
  })
})
