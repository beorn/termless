# Bundled fonts

The canonical termless font assets, owned by `@termless/core` and consumed by
two render paths:

- **`@termless/ghostty`'s canvas renderer** registers them process-wide via
  `GlobalFonts.registerFromPath` so cell geometry is deterministic across
  platforms and emoji/symbol glyphs never render as tofu. The renderer does
  NOT use the platform `monospace` alias — that alias has unstable,
  platform-dependent metrics (Skia picks a different face per OS).
- **`@termless/core`'s `@resvg/resvg-js` SVG→raster path** (`gif.ts`,
  `apng.ts`, `png.ts`, `record --screenshot *.png`) passes them to resvg's
  `font.fontFiles` so emoji/symbol code points resolve instead of `.notdef`
  tofu.

The directory is resolved through `src/render/fonts.ts`; there is one bundled
copy, not one per package.

| File                           | Font                    | License | Source                                     |
| ------------------------------ | ----------------------- | ------- | ------------------------------------------ |
| `JetBrainsMono-Regular.ttf`    | JetBrains Mono          | OFL-1.1 | https://github.com/JetBrains/JetBrainsMono |
| `NotoSansSymbols2-Regular.ttf` | Noto Sans Symbols 2     | OFL-1.1 | https://github.com/notofonts/symbols       |
| `NotoEmoji-Regular.ttf`        | Noto Emoji (monochrome) | OFL-1.1 | https://github.com/googlefonts/noto-emoji  |

All three are licensed under the SIL Open Font License 1.1 — redistributable,
including bundled inside an npm package. Noto Emoji is the **monochrome**
build, kept as the last-resort fallback when `@twemoji/svg` is not installed
or a codepoint is outside the Twemoji catalogue.

Roles:

- **JetBrains Mono** — the default primary monospace face. True fixed pitch,
  broad Latin + box-drawing + geometric-shape coverage.
- **Noto Sans Symbols 2** — fallback for terminal symbol glyphs JetBrains Mono
  lacks (e.g. the hourglass U+29D7, rarer geometric shapes, arrows).
- **Noto Emoji** — last-resort monochrome fallback for emoji code points; in
  the canvas path it's the only emoji face and renders cleanly. In the resvg
  path, color emoji is delivered via `<image>` injection from `@twemoji/svg`
  (see `src/render/emoji.ts`) because resvg-js does not support any color
  font format (CBDT/sbix, COLR/CPAL, OT-SVG) — see the canonical commentary
  in `src/render/emoji.ts` for the empirical rationale.
