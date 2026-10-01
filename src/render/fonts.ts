/**
 * Bundled fallback fonts — the canonical termless font assets.
 *
 * Five OFL-licensed faces ship inside `@termless/core` under `assets/fonts`:
 *
 *   - JetBrains Mono       — primary monospace face, Regular and Bold (broad Latin + box-drawing)
 *   - Noto Sans Symbols 2  — terminal symbol glyphs JetBrains Mono lacks
 *   - Symbols Nerd Font    — Nerd Font private-use icons (powerline, devicons,
 *                            the U+F0xx/U+E0xx glyphs TUIs like km use)
 *   - Noto Emoji (mono)    — emoji code points (📁 📋 📄, status emoji)
 *
 * Two render paths consume these:
 *
 *   - The `@resvg/resvg-js` SVG→raster path (`./view/gif.ts`, `./view/apng.ts`,
 *     `record --screenshot *.png`) — passes the font files to resvg's
 *     `font.fontFiles` so emoji/symbol code points resolve instead of tofu.
 *   - `@termless/ghostty`'s `@napi-rs/canvas` renderer — registers them
 *     process-wide via `GlobalFonts.registerFromPath`.
 *
 * Both packages resolve the directory through this module so there is a
 * single bundled copy, owned by `@termless/core` (the foundational package).
 */

import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { existsSync } from "node:fs"
import { findPackageRoot } from "../package-root.ts"

/** Family names the bundled fonts are registered under (CSS `font-family`). */
export const BUNDLED_PRIMARY_FAMILY = "TermlessMono"
export const BUNDLED_SYMBOL_FAMILY = "TermlessSymbols"
export const BUNDLED_NERD_FAMILY = "TermlessNerd"
export const BUNDLED_EMOJI_FAMILY = "TermlessEmoji"

/** One bundled font: a file name (relative to the fonts dir) + its family. */
export interface BundledFont {
  file: string
  family: string
  /** The face's CSS weight. Two faces share the primary family, so each embedded @font-face rule must say which it is. */
  weight: 400 | 700
}

/**
 * The bundled faces, in fallback order. The primary face is first; the
 * symbol + emoji faces follow so per-glyph fallback resolves in that order.
 */
export const BUNDLED_FONTS: readonly BundledFont[] = [
  { file: "JetBrainsMono-Regular.ttf", family: BUNDLED_PRIMARY_FAMILY, weight: 400 },
  // The bold face under the same family: resvg matches font-weight="bold" to it and does not
  // synthesize a bold from Regular the way Skia does, so without it every bold cell drew regular (25786).
  { file: "JetBrainsMono-Bold.ttf", family: BUNDLED_PRIMARY_FAMILY, weight: 700 },
  { file: "NotoSansSymbols2-Regular.ttf", family: BUNDLED_SYMBOL_FAMILY, weight: 400 },
  { file: "SymbolsNerdFontMono-Regular.ttf", family: BUNDLED_NERD_FAMILY, weight: 400 },
  { file: "NotoEmoji-Regular.ttf", family: BUNDLED_EMOJI_FAMILY, weight: 400 },
]

/**
 * Resolve the bundled `assets/fonts` directory in both layouts:
 *   - dev:       `<pkg>/src/render/fonts.ts`  → `<pkg>/assets/fonts`
 *   - published: `<pkg>/dist/index.mjs`       → `<pkg>/assets/fonts`
 *
 * In dev the file sits two levels deep (`src/render/`), in a published build
 * one level deep (`dist/`). The shared root resolver matches the owning
 * package's name, so both layouts resolve without a build-time guess.
 *
 * A published backend package (`@termless/ghostty`) bundles this module into
 * its own `dist/`, whose package identity does not match core: fonts ship only
 * in `@termless/core`, its peer dependency. So the lookup runs again from where
 * `@termless/core` itself resolves.
 */
export function bundledFontsDir(): string {
  const found = findFontsUpward(dirname(fileURLToPath(import.meta.url))) ?? findFontsUpward(coreEntryDir())
  if (found !== undefined) return found
  // Missing font files remain optional, but their path must belong to core.
  const root = findPackageRoot(coreEntryDir() ?? dirname(fileURLToPath(import.meta.url)), "@termless/core")
  return join(root, "assets", "fonts")
}

/** The fonts directory of the name-matched core package owning `start`. */
export function findFontsUpward(start: string | undefined): string | undefined {
  if (start === undefined) return undefined
  let root: string
  try {
    root = findPackageRoot(start, "@termless/core")
  } catch {
    // silent-fallback-allow: an inlined backend must try its required core peer next; bundledFontsDir reports both absent roots.
    return undefined
  }
  const candidate = join(root, "assets", "fonts")
  return existsSync(candidate) ? candidate : undefined
}

/** The directory `@termless/core`'s entry resolves to from here, or undefined when it does not resolve. */
function coreEntryDir(): string | undefined {
  let entry: string
  try {
    entry = import.meta.resolve("@termless/core")
  } catch {
    // silent-fallback-allow: @termless/core not installed beside this copy leaves the upward probe as the only place to look; a render that then lacks its primary face throws naming the path
    return undefined
  }
  return entry.startsWith("file:") ? dirname(fileURLToPath(entry)) : undefined
}

/**
 * Absolute paths of the bundled font files that actually exist on disk.
 * Missing files are skipped silently — a partial fallback chain still beats
 * a hard failure, and the bundled-font test pins the happy path.
 */
export function bundledFontFiles(): string[] {
  const dir = bundledFontsDir()
  const files: string[] = []
  for (const { file } of BUNDLED_FONTS) {
    const path = join(dir, file)
    if (existsSync(path)) files.push(path)
  }
  return files
}
