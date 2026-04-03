/**
 * Built-in themes for termless recordings.
 *
 * Each theme defines foreground, background, cursor, and (optionally) the
 * 16-color ANSI palette. Theme names are case-insensitive and common aliases
 * are supported (e.g. "catppuccin" → "catppuccin-mocha").
 *
 * When @silvery/theme is available (optional peer dependency), all 45+
 * palettes are automatically mapped to SvgTheme objects and exposed alongside
 * the built-in fallback themes.
 */

import type { SvgTheme } from "../types.ts"

// =============================================================================
// Built-in fallback themes (used when @silvery/theme is not installed)
// =============================================================================

const BUILTIN_THEMES: Record<string, SvgTheme> = {
  dracula: {
    background: "#282a36",
    foreground: "#f8f8f2",
    cursor: "#f8f8f2",
    palette: {
      0: "#21222c",
      1: "#ff5555",
      2: "#50fa7b",
      3: "#f1fa8c",
      4: "#bd93f9",
      5: "#ff79c6",
      6: "#8be9fd",
      7: "#f8f8f2",
      8: "#6272a4",
      9: "#ff6e6e",
      10: "#69ff94",
      11: "#ffffa5",
      12: "#d6acff",
      13: "#ff92df",
      14: "#a4ffff",
      15: "#ffffff",
    },
  },
  nord: {
    background: "#2e3440",
    foreground: "#d8dee9",
    cursor: "#d8dee9",
    palette: {
      0: "#3b4252",
      1: "#bf616a",
      2: "#a3be8c",
      3: "#ebcb8b",
      4: "#81a1c1",
      5: "#b48ead",
      6: "#88c0d0",
      7: "#e5e9f0",
      8: "#4c566a",
      9: "#bf616a",
      10: "#a3be8c",
      11: "#ebcb8b",
      12: "#81a1c1",
      13: "#b48ead",
      14: "#8fbcbb",
      15: "#eceff4",
    },
  },
  monokai: {
    background: "#272822",
    foreground: "#f8f8f2",
    cursor: "#f8f8f2",
    palette: {
      0: "#272822",
      1: "#f92672",
      2: "#a6e22e",
      3: "#f4bf75",
      4: "#66d9ef",
      5: "#ae81ff",
      6: "#a1efe4",
      7: "#f8f8f2",
      8: "#75715e",
      9: "#f92672",
      10: "#a6e22e",
      11: "#f4bf75",
      12: "#66d9ef",
      13: "#ae81ff",
      14: "#a1efe4",
      15: "#f9f8f5",
    },
  },
  "catppuccin-mocha": {
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    cursor: "#f5e0dc",
    palette: {
      0: "#45475a",
      1: "#f38ba8",
      2: "#a6e3a1",
      3: "#f9e2af",
      4: "#89b4fa",
      5: "#f5c2e7",
      6: "#94e2d5",
      7: "#bac2de",
      8: "#585b70",
      9: "#f38ba8",
      10: "#a6e3a1",
      11: "#f9e2af",
      12: "#89b4fa",
      13: "#f5c2e7",
      14: "#94e2d5",
      15: "#a6adc8",
    },
  },
  "tokyo-night": {
    background: "#1a1b26",
    foreground: "#a9b1d6",
    cursor: "#c0caf5",
    palette: {
      0: "#15161e",
      1: "#f7768e",
      2: "#9ece6a",
      3: "#e0af68",
      4: "#7aa2f7",
      5: "#bb9af7",
      6: "#7dcfff",
      7: "#a9b1d6",
      8: "#414868",
      9: "#f7768e",
      10: "#9ece6a",
      11: "#e0af68",
      12: "#7aa2f7",
      13: "#bb9af7",
      14: "#7dcfff",
      15: "#c0caf5",
    },
  },
  "solarized-dark": {
    background: "#002b36",
    foreground: "#839496",
    cursor: "#93a1a1",
    palette: {
      0: "#073642",
      1: "#dc322f",
      2: "#859900",
      3: "#b58900",
      4: "#268bd2",
      5: "#d33682",
      6: "#2aa198",
      7: "#eee8d5",
      8: "#002b36",
      9: "#cb4b16",
      10: "#586e75",
      11: "#657b83",
      12: "#839496",
      13: "#6c71c4",
      14: "#93a1a1",
      15: "#fdf6e3",
    },
  },
  "solarized-light": {
    background: "#fdf6e3",
    foreground: "#657b83",
    cursor: "#586e75",
    palette: {
      0: "#073642",
      1: "#dc322f",
      2: "#859900",
      3: "#b58900",
      4: "#268bd2",
      5: "#d33682",
      6: "#2aa198",
      7: "#eee8d5",
      8: "#002b36",
      9: "#cb4b16",
      10: "#586e75",
      11: "#657b83",
      12: "#839496",
      13: "#6c71c4",
      14: "#93a1a1",
      15: "#fdf6e3",
    },
  },
  "github-dark": {
    background: "#0d1117",
    foreground: "#c9d1d9",
    cursor: "#c9d1d9",
    palette: {
      0: "#484f58",
      1: "#ff7b72",
      2: "#3fb950",
      3: "#d29922",
      4: "#58a6ff",
      5: "#bc8cff",
      6: "#39c5cf",
      7: "#b1bac4",
      8: "#6e7681",
      9: "#ffa198",
      10: "#56d364",
      11: "#e3b341",
      12: "#79c0ff",
      13: "#d2a8ff",
      14: "#56d4dd",
      15: "#f0f6fc",
    },
  },
  "github-light": {
    background: "#ffffff",
    foreground: "#24292f",
    cursor: "#24292f",
    palette: {
      0: "#24292e",
      1: "#d73a49",
      2: "#22863a",
      3: "#b08800",
      4: "#0366d6",
      5: "#6f42c1",
      6: "#1b7c83",
      7: "#6a737d",
      8: "#959da5",
      9: "#cb2431",
      10: "#28a745",
      11: "#dbab09",
      12: "#2188ff",
      13: "#8a63d2",
      14: "#3192aa",
      15: "#d1d5da",
    },
  },
  "gruvbox-dark": {
    background: "#282828",
    foreground: "#ebdbb2",
    cursor: "#ebdbb2",
    palette: {
      0: "#282828",
      1: "#cc241d",
      2: "#98971a",
      3: "#d79921",
      4: "#458588",
      5: "#b16286",
      6: "#689d6a",
      7: "#a89984",
      8: "#928374",
      9: "#fb4934",
      10: "#b8bb26",
      11: "#fabd2f",
      12: "#83a598",
      13: "#d3869b",
      14: "#8ec07c",
      15: "#ebdbb2",
    },
  },
  "one-dark": {
    background: "#282c34",
    foreground: "#abb2bf",
    cursor: "#528bff",
    palette: {
      0: "#282c34",
      1: "#e06c75",
      2: "#98c379",
      3: "#e5c07b",
      4: "#61afef",
      5: "#c678dd",
      6: "#56b6c2",
      7: "#abb2bf",
      8: "#545862",
      9: "#e06c75",
      10: "#98c379",
      11: "#e5c07b",
      12: "#61afef",
      13: "#c678dd",
      14: "#56b6c2",
      15: "#c8ccd4",
    },
  },
  "rose-pine": {
    background: "#191724",
    foreground: "#e0def4",
    cursor: "#ebbcba",
    palette: {
      0: "#26233a",
      1: "#eb6f92",
      2: "#9ccfd8",
      3: "#f6c177",
      4: "#31748f",
      5: "#c4a7e7",
      6: "#9ccfd8",
      7: "#e0def4",
      8: "#6e6a86",
      9: "#eb6f92",
      10: "#9ccfd8",
      11: "#f6c177",
      12: "#31748f",
      13: "#c4a7e7",
      14: "#9ccfd8",
      15: "#e0def4",
    },
  },
}

// =============================================================================
// Aliases (work for both built-in and silvery themes)
// =============================================================================

const ALIASES: Record<string, string> = {
  catppuccin: "catppuccin-mocha",
  solarized: "solarized-dark",
  gruvbox: "gruvbox-dark",
  github: "github-dark",
  kanagawa: "kanagawa-wave",
  material: "material-dark",
  oxocarbon: "oxocarbon-dark",
  edge: "edge-dark",
  ayu: "ayu-dark",
  everforest: "everforest-dark",
  modus: "modus-vivendi",
}

// =============================================================================
// @silvery/theme integration (optional peer dependency)
// =============================================================================

/**
 * Map a silvery ColorPalette to an SvgTheme.
 *
 * ColorPalette has named fields (black, red, green, ..., brightWhite)
 * which map to ANSI indices 0-15.
 */
interface ColorPaletteLike {
  name?: string
  foreground: string
  background: string
  cursorColor: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

function paletteToSvgTheme(p: ColorPaletteLike): SvgTheme {
  return {
    foreground: p.foreground.toLowerCase(),
    background: p.background.toLowerCase(),
    cursor: p.cursorColor.toLowerCase(),
    palette: {
      0: p.black.toLowerCase(),
      1: p.red.toLowerCase(),
      2: p.green.toLowerCase(),
      3: p.yellow.toLowerCase(),
      4: p.blue.toLowerCase(),
      5: p.magenta.toLowerCase(),
      6: p.cyan.toLowerCase(),
      7: p.white.toLowerCase(),
      8: p.brightBlack.toLowerCase(),
      9: p.brightRed.toLowerCase(),
      10: p.brightGreen.toLowerCase(),
      11: p.brightYellow.toLowerCase(),
      12: p.brightBlue.toLowerCase(),
      13: p.brightMagenta.toLowerCase(),
      14: p.brightCyan.toLowerCase(),
      15: p.brightWhite.toLowerCase(),
    },
  }
}

/**
 * Lazily load @silvery/theme palettes on first access.
 * Uses synchronous require() to avoid top-level await, which would make
 * @termless/core an async module and break require() callers (e.g. silvery's createTerm).
 * Falls back to empty record if @silvery/theme is not installed.
 */
let _silveryThemes: Record<string, SvgTheme> | undefined
function getSilveryThemes(): Record<string, SvgTheme> {
  if (_silveryThemes !== undefined) return _silveryThemes
  try {
    const themePkg = "@silvery/theme"
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(themePkg) as { builtinPalettes?: Record<string, ColorPaletteLike> }
    const palettes = mod.builtinPalettes
    if (!palettes) {
      _silveryThemes = {}
      return _silveryThemes
    }

    const result: Record<string, SvgTheme> = {}
    for (const [name, palette] of Object.entries(palettes)) {
      result[name] = paletteToSvgTheme(palette)
    }
    _silveryThemes = result
    return _silveryThemes
  } catch {
    _silveryThemes = {}
    return _silveryThemes
  }
}

// =============================================================================
// Merged theme access
// =============================================================================

/**
 * Get all available themes (silvery palettes override built-in for same name).
 */
function getAllThemes(): Record<string, SvgTheme> {
  // Silvery themes take precedence over built-in for overlapping names
  const silveryThemes = getSilveryThemes()
  if (Object.keys(silveryThemes).length > 0) {
    return { ...BUILTIN_THEMES, ...silveryThemes }
  }
  return BUILTIN_THEMES
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Resolve a theme name to an SvgTheme. Case-insensitive, supports aliases.
 * Returns undefined for unknown themes.
 *
 * When @silvery/theme is available, resolves from all 45+ silvery palettes
 * in addition to the 12 built-in fallback themes.
 */
export function resolveTheme(name: string): SvgTheme | undefined {
  const normalized = name.toLowerCase()
  const resolved = ALIASES[normalized] ?? normalized
  return getAllThemes()[resolved]
}

/**
 * List all available theme names (canonical names only, not aliases).
 *
 * When @silvery/theme is installed, includes all silvery palette names
 * alongside built-in themes (deduplicated).
 */
export function listThemes(): string[] {
  return Object.keys(getAllThemes())
}

/**
 * List all theme aliases as [alias, canonical] pairs.
 */
export function listAliases(): [string, string][] {
  return Object.entries(ALIASES)
}
