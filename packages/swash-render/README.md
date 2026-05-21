# @termless/swash-render

Pure-native [swash](https://github.com/dfrg/swash) text rasterizer for termless
— a napi-rs binding that turns a terminal **cell grid** into an RGBA bitmap.

swash is a pure-Rust, browser-grade headless text rasterizer (the cosmic-text /
Linebender lineage): full shaping, TrueType + CFF outlines, and — the reason
this package exists — **color emoji** across sbix / CBDT / COLR. termless's
`canvas` (Skia via `@napi-rs/canvas`) and `resvg` renderers both lose the system
color-emoji table and fall back to monochrome line-art; swash reads the color
tables directly, so 📁 / 📋 / ✅ / 🔥 render in full color.

The native binding is ~1.3 MB — far smaller than `@napi-rs/canvas`'s ~26 MB.

## Why a cell-grid API (not SVG)

swash does shaping + glyph rasterization only; it has no cell-grid layout layer.
This crate ports the fixed-pitch grid walk (per-cell fg/bg, wide-char advance) —
see `native/src/lib.rs`. termless already owns the cell grid (it feeds both the
`canvas` and `resvg` renderers), so the public API consumes that grid directly
rather than round-tripping through SVG, which would flatten away the very color
information swash exists to preserve.

## Build

The native `.node` binary must be built before use (phase 1 ships macOS-arm64;
cross-platform prebuilds are a later phase):

```sh
bun run build:native       # cargo build --release
bun run postbuild:native   # copy the dylib/so/dll to termless-swash-render.node
```

## Usage

```ts
import { renderCells } from "@termless/swash-render"

// `term` is any termless TerminalReadable
const bitmap = renderCells(term)            // { pixels, width, height }
```

Or via the termless renderer enum:

```sh
termless record --renderer swash -o out.png
```

```ts
await term.screenshot({ renderer: "swash" })
```
