# Bundled fonts

`@termless/ghostty`'s canvas renderer registers these fonts process-wide so
cell geometry is deterministic across platforms. The renderer does NOT use the
platform `monospace` alias — that alias has unstable, platform-dependent
metrics (Skia picks a different face per OS, sometimes proportional).

| File                        | Font           | License | Source                                     |
| --------------------------- | -------------- | ------- | ------------------------------------------ |
| `JetBrainsMono-Regular.ttf` | JetBrains Mono | OFL-1.1 | https://github.com/JetBrains/JetBrainsMono |

Licensed under the SIL Open Font License 1.1 — redistributable, including
bundled inside an npm package.

- **JetBrains Mono** — the default primary monospace face. True fixed pitch,
  broad Latin + box-drawing + geometric-shape coverage.
