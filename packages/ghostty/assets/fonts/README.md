# Bundled fonts

`@termless/ghostty`'s canvas renderer registers these fonts process-wide so
cell geometry is deterministic across platforms and emoji/symbol glyphs never
render as tofu. The renderer does NOT use the platform `monospace` alias —
that alias has unstable, platform-dependent metrics (Skia picks a different
face per OS, sometimes proportional).

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
