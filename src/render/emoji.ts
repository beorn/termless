/**
 * Color emoji rendering for the resvg path.
 *
 * `@resvg/resvg-js` (the SVG→PNG rasterizer behind {@link screenshotPng},
 * `view/gif.ts`, `view/apng.ts`) inherits from upstream `resvg` and as of
 * 2.6.2 supports NO color font format — not CBDT/sbix (Apple Color Emoji),
 * not COLR/CPAL (Twemoji Mozilla), not OT-SVG (TwitterColorEmoji-SVGinOT,
 * Noto Color Emoji). Upstream issue resvg#487 has been open since Nov 2021.
 *
 * The bundled `NotoEmoji-Regular.ttf` (monochrome) is what resvg can actually
 * render — a thin outlined glyph that drops the user-visible color. To match
 * what users see in their real terminal we side-step the font path entirely:
 *
 *   - {@link toTwemojiKey} converts an emoji string (one or more codepoints)
 *     to the canonical Twemoji asset key (e.g. "📁" → "1f4c1", "👨‍💻" →
 *     "1f468-200d-1f4bb"). The Twemoji rule strips U+FE0F unless a U+200D
 *     ZWJ is also present in the sequence.
 *   - {@link loadTwemojiSvg} reads the SVG asset for a key from the optional
 *     `@twemoji/svg` peer dependency (~17 MB of 3700 SVGs, MIT for code,
 *     CC-BY for graphics). Returns a base64-encoded `data:image/svg+xml;base64`
 *     URI suitable for the `href` of an SVG `<image>` element — resvg renders
 *     nested SVG via `<image>` correctly even when it cannot render the same
 *     emoji from a font.
 *   - {@link isLikelyEmoji} is a permissive codepoint test; the caller must
 *     still try {@link loadTwemojiSvg} and fall back to font rendering if the
 *     asset is missing (asset absence is a soft signal, not a hard error).
 *
 * The canvas path in `@termless/ghostty` does not need any of this — Skia
 * (`@napi-rs/canvas`) renders Apple Color Emoji natively on macOS.
 */

import { readFileSync } from "node:fs"
import { resolveOptionalAsset } from "../load-native.ts"

/**
 * Convert an emoji codepoint sequence to the Twemoji asset filename stem.
 *
 * Twemoji rule: lowercase hex codepoints joined by `-`, with U+FE0F (the
 * emoji variation selector) stripped UNLESS the sequence contains a U+200D
 * (zero-width joiner) — joined sequences keep their variation selectors
 * because the joined glyph requires them.
 *
 * Examples:
 *   "📁"       → "1f4c1"
 *   "❤️"       → "2764"            (FE0F stripped)
 *   "☎️"       → "260e"            (FE0F stripped)
 *   "👨‍💻"     → "1f468-200d-1f4bb" (ZWJ present; FE0F kept if any)
 */
export function toTwemojiKey(text: string): string {
  const cps: number[] = []
  for (const ch of text) cps.push(ch.codePointAt(0)!)
  const hasZwj = cps.includes(0x200d)
  const filtered = hasZwj ? cps : cps.filter((cp) => cp !== 0xfe0f)
  return filtered.map((cp) => cp.toString(16)).join("-")
}

/**
 * Permissive emoji-codepoint test. Returns true for codepoints that LIKELY
 * have a Twemoji asset; the caller must still attempt to load the asset and
 * fall back to font rendering on miss.
 *
 * Covers the major emoji ranges in BMP and supplementary planes:
 *   - U+1F300 .. U+1FBFF — Misc Symbols & Pictographs, Emoticons, Transport,
 *                          Supp Symbols & Pictographs, Symbols & Pictographs
 *                          Extended-A, plus the legacy/extended blocks.
 *   - U+2300 .. U+27BF   — Misc Technical, Dingbats, Misc Symbols
 *   - U+2600 .. U+26FF   — Misc Symbols (☎ ☕ ☀ ★ etc.)
 *   - U+2700 .. U+27BF   — Dingbats (✂ ✈ ❤ etc.)
 *   - U+1F000 .. U+1F2FF — Mahjong, Domino, Playing cards, Enclosed Alphanum
 *
 * Single-codepoint test is enough: a multi-codepoint sequence (ZWJ joined,
 * skin tone modifiers, flags) always has its first codepoint in one of the
 * emoji-bearing ranges.
 */
export function isLikelyEmoji(text: string): boolean {
  const cp = text.codePointAt(0)
  if (cp === undefined) return false
  // Supplementary plane emoji ranges
  if (cp >= 0x1f000 && cp <= 0x1fbff) return true
  // BMP symbol/dingbat/misc ranges
  if (cp >= 0x2300 && cp <= 0x27bf) return true
  // Regional indicators (flags) — U+1F1E6 .. U+1F1FF covered above
  return false
}

// In-process cache: key → base64 data URI (or null if the asset is missing).
const dataUriCache = new Map<string, string | null>()

/**
 * Load the Twemoji SVG asset for a key as a `data:image/svg+xml;base64` URI,
 * or return null if the asset is missing (peer dep not installed, or the
 * codepoint is not in the Twemoji catalogue). The URI is suitable for the
 * `href` attribute of an SVG `<image>` element and embeds the entire SVG
 * inline so the parent SVG is self-contained.
 *
 * Resolution is via Node-style `require.resolve("@twemoji/svg/<key>.svg")`
 * — works under both Bun and Node and respects the consumer's `node_modules`
 * layout. Missing assets are cached as `null` so repeated misses are cheap.
 */
export function loadTwemojiSvg(key: string): string | null {
  const cached = dataUriCache.get(key)
  if (cached !== undefined) return cached
  try {
    const path = resolveOptionalAsset(`@twemoji/svg/${key}.svg`)
    const svg = readFileSync(path, "utf8")
    const b64 = Buffer.from(svg).toString("base64")
    const uri = `data:image/svg+xml;base64,${b64}`
    dataUriCache.set(key, uri)
    return uri
  } catch {
    dataUriCache.set(key, null)
    return null
  }
}
