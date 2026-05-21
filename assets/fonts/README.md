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
build (not the color COLR build): a terminal-faithful look that composes with
the renderer's truecolor SGR foreground.

Roles:

- **JetBrains Mono** — the default primary monospace face. True fixed pitch,
  broad Latin + box-drawing + geometric-shape coverage.
- **Noto Sans Symbols 2** — fallback for terminal symbol glyphs JetBrains Mono
  lacks (e.g. the hourglass U+29D7, rarer geometric shapes, arrows).
- **Noto Emoji** — fallback for emoji code points (📁 📋 📄, status emoji).
