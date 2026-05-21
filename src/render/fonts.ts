/**
 * Bundled fallback fonts — the canonical termless font assets.
 *
 * Three OFL-licensed faces ship inside `@termless/core` under `assets/fonts`:
 *
 *   - JetBrains Mono       — primary monospace face (broad Latin + box-drawing)
 *   - Noto Sans Symbols 2  — terminal symbol glyphs JetBrains Mono lacks
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

/** Family names the bundled fonts are registered under (CSS `font-family`). */
export const BUNDLED_PRIMARY_FAMILY = "TermlessMono"
export const BUNDLED_SYMBOL_FAMILY = "TermlessSymbols"
export const BUNDLED_EMOJI_FAMILY = "TermlessEmoji"

/** One bundled font: a file name (relative to the fonts dir) + its family. */
export interface BundledFont {
  file: string
  family: string
}

/**
 * The bundled faces, in fallback order. The primary face is first; the
 * symbol + emoji faces follow so per-glyph fallback resolves in that order.
 */
export const BUNDLED_FONTS: readonly BundledFont[] = [
  { file: "JetBrainsMono-Regular.ttf", family: BUNDLED_PRIMARY_FAMILY },
  { file: "NotoSansSymbols2-Regular.ttf", family: BUNDLED_SYMBOL_FAMILY },
  { file: "NotoEmoji-Regular.ttf", family: BUNDLED_EMOJI_FAMILY },
]

/**
 * Resolve the bundled `assets/fonts` directory in both layouts:
 *   - dev:       `<pkg>/src/render/fonts.ts`  → `<pkg>/assets/fonts`
 *   - published: `<pkg>/dist/index.mjs`       → `<pkg>/assets/fonts`
 *
 * In dev the file sits two levels deep (`src/render/`), in a published build
 * one level deep (`dist/`). We probe upward for the first ancestor that has
 * an `assets/fonts` child so both layouts resolve without a build-time guess.
 */
export function bundledFontsDir(): string {
  let here = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 4; i++) {
    const candidate = join(here, "assets", "fonts")
    if (existsSync(candidate)) return candidate
    here = dirname(here)
  }
  // Fall back to the dev layout (`src/render/` → two levels up) so callers
  // get a deterministic path even when the assets are absent.
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "fonts")
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
