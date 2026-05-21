//! `@termless/swash-render` — a napi-rs binding wrapping the [`swash`] crate.
//!
//! swash is a pure-Rust, browser-grade headless text rasterizer (the
//! cosmic-text / Linebender lineage). It does font shaping + glyph
//! rasterization — including color emoji across sbix / CBDT / COLR — with no
//! Skia, no browser, no system dependency.
//!
//! swash itself has **no cell-grid layout layer**: it rasterizes one glyph at
//! a time. This crate ports the fixed-pitch grid walk (per-cell fg/bg, cursor,
//! wide-char advance) that asciinema's `agg` implements in its `renderer`
//! module — `agg` is GPL, so the swash API usage here is re-implemented from
//! the public swash docs, not copied.
//!
//! The single exported entry point is [`render`]: a termless cell grid plus a
//! font fallback chain in → an RGBA buffer out.

use napi::bindgen_prelude::*;
use napi_derive::napi;
use swash::scale::{Render, ScaleContext, Source, StrikeWith};
use swash::scale::image::Content;
use swash::{FontRef, GlyphId};
use zeno::Format;

// ===========================================================================
// Exported types
// ===========================================================================

/// One terminal cell, flattened for the napi boundary.
///
/// A flat object (rather than a nested `{ fg: RGB | null }`) keeps the
/// JS↔Rust marshalling cheap: napi-rs converts each field directly with no
/// per-cell allocation of sub-objects.
#[napi(object)]
pub struct SwashCell {
    /// The cell's text — usually one grapheme; empty for a wide-char tail.
    pub text: String,
    /// Foreground RGB packed as `0xRRGGBB`; `-1` means "use the default fg".
    pub fg: i32,
    /// Background RGB packed as `0xRRGGBB`; `-1` means "use the default bg".
    pub bg: i32,
    /// Bold — rendered via synthetic emboldening when the face lacks a bold cut.
    pub bold: bool,
    /// True for the head cell of a double-width glyph (emoji / CJK).
    pub wide: bool,
    /// True for the (empty) trailing cell of a wide glyph — skipped entirely.
    pub continuation: bool,
}

/// One font in the fallback chain.
#[napi(object)]
pub struct SwashFont {
    /// Raw font file bytes (`.ttf` / `.otf` / `.ttc`).
    pub data: Buffer,
    /// Collection index — 0 for a single-face file, the face index for `.ttc`.
    pub index: u32,
}

/// Inputs for one [`render`] call.
#[napi(object)]
pub struct SwashRenderOptions {
    /// Cell grid in row-major order; `cols * rows` entries.
    pub cells: Vec<SwashCell>,
    /// Grid width in cells.
    pub cols: u32,
    /// Grid height in cells.
    pub rows: u32,
    /// Cell advance width in pixels (the fixed monospace pitch).
    pub cell_width: f64,
    /// Cell box height in pixels (the line height).
    pub cell_height: f64,
    /// Glyph render size in pixels.
    pub font_size: f64,
    /// Baseline offset from the top of the cell box, in pixels.
    pub baseline: f64,
    /// Font fallback chain — primary face first, symbol / emoji faces after.
    pub fonts: Vec<SwashFont>,
    /// Default foreground `0xRRGGBB` (used when a cell's `fg` is `-1`).
    pub default_fg: u32,
    /// Default background `0xRRGGBB` (used when a cell's `bg` is `-1`).
    pub default_bg: u32,
    /// Padding around the grid in pixels (applied on every side).
    pub padding: u32,
}

/// An RGBA bitmap returned from [`render`].
#[napi(object)]
pub struct SwashBitmap {
    /// RGBA pixel bytes, row-major, 4 bytes per pixel, premultiplied straight.
    pub pixels: Buffer,
    /// Bitmap width in pixels.
    pub width: u32,
    /// Bitmap height in pixels.
    pub height: u32,
}

// ===========================================================================
// Color helpers
// ===========================================================================

#[inline]
fn unpack(rgb: u32) -> (u8, u8, u8) {
    (((rgb >> 16) & 0xff) as u8, ((rgb >> 8) & 0xff) as u8, (rgb & 0xff) as u8)
}

/// Alpha-composite `src` (RGBA, straight alpha) over `dst` (RGB, opaque).
#[inline]
fn blend(dst: &mut [u8], sr: u8, sg: u8, sb: u8, sa: u8) {
    if sa == 0 {
        return;
    }
    if sa == 255 {
        dst[0] = sr;
        dst[1] = sg;
        dst[2] = sb;
        dst[3] = 255;
        return;
    }
    let a = sa as u32;
    let ia = 255 - a;
    dst[0] = ((sr as u32 * a + dst[0] as u32 * ia) / 255) as u8;
    dst[1] = ((sg as u32 * a + dst[1] as u32 * ia) / 255) as u8;
    dst[2] = ((sb as u32 * a + dst[2] as u32 * ia) / 255) as u8;
    dst[3] = 255;
}

// ===========================================================================
// Font chain
// ===========================================================================

/// A loaded font face plus its collection offset, kept alive for the call.
struct Face {
    data: Vec<u8>,
    offset: u32,
}

impl Face {
    fn font_ref(&self) -> Option<FontRef<'_>> {
        FontRef::from_index(&self.data, self.offset as usize)
    }
}

/// Resolve the first face in the chain that has a glyph for `ch`.
///
/// Returns the face index and the glyph id. Falls back to face 0 / glyph 0
/// (`.notdef`) when nothing in the chain covers the codepoint.
fn resolve_glyph(faces: &[Face], ch: char) -> (usize, GlyphId) {
    for (i, face) in faces.iter().enumerate() {
        if let Some(font) = face.font_ref() {
            let gid = font.charmap().map(ch);
            if gid != 0 {
                return (i, gid);
            }
        }
    }
    (0, 0)
}

// ===========================================================================
// render
// ===========================================================================

/// Rasterize a termless cell grid into an RGBA bitmap via swash.
///
/// The grid is walked in fixed monospace pitch: each cell paints its
/// background rectangle, then its glyph is shaped + scaled by swash and
/// alpha-composited at the cell's pen position. Color-emoji cells composite
/// the swash color bitmap directly — this is the fidelity win over the
/// Skia / resvg paths, which lose the system color-emoji table.
#[napi]
pub fn render(opts: SwashRenderOptions) -> Result<SwashBitmap> {
    let cols = opts.cols as usize;
    let rows = opts.rows as usize;
    if opts.cells.len() != cols * rows {
        return Err(Error::from_reason(format!(
            "cells length {} != cols*rows {}",
            opts.cells.len(),
            cols * rows
        )));
    }
    if opts.fonts.is_empty() {
        return Err(Error::from_reason("at least one font is required"));
    }

    let pad = opts.padding as i64;
    let width = (cols as f64 * opts.cell_width).ceil() as i64 + pad * 2;
    let height = (rows as f64 * opts.cell_height).ceil() as i64 + pad * 2;
    if width <= 0 || height <= 0 {
        return Err(Error::from_reason("computed bitmap has zero area"));
    }
    let width = width as usize;
    let height = height as usize;

    // Faces are copied into owned Vec<u8> so FontRef borrows stay valid.
    let faces: Vec<Face> = opts
        .fonts
        .iter()
        .map(|f| Face { data: f.data.to_vec(), offset: f.index })
        .collect();

    // Fill the whole canvas with the default background.
    let (dbg_r, dbg_g, dbg_b) = unpack(opts.default_bg);
    let mut buf = vec![0u8; width * height * 4];
    for px in buf.chunks_exact_mut(4) {
        px[0] = dbg_r;
        px[1] = dbg_g;
        px[2] = dbg_b;
        px[3] = 255;
    }

    let mut ctx = ScaleContext::new();

    for row in 0..rows {
        for col in 0..cols {
            let cell = &opts.cells[row * cols + col];
            if cell.continuation {
                continue;
            }
            let x0 = pad + (col as f64 * opts.cell_width) as i64;
            let y0 = pad + (row as f64 * opts.cell_height) as i64;
            let span = if cell.wide { 2.0 } else { 1.0 };

            // ── background rectangle ───────────────────────────────────────
            if cell.bg >= 0 {
                let (br, bg_, bb) = unpack(cell.bg as u32);
                let x1 = pad + ((col as f64 + span) * opts.cell_width) as i64;
                let y1 = pad + ((row as f64 + 1.0) * opts.cell_height) as i64;
                for y in y0.max(0)..y1.min(height as i64) {
                    for x in x0.max(0)..x1.min(width as i64) {
                        let i = ((y as usize) * width + x as usize) * 4;
                        buf[i] = br;
                        buf[i + 1] = bg_;
                        buf[i + 2] = bb;
                        buf[i + 3] = 255;
                    }
                }
            }

            // ── glyph ──────────────────────────────────────────────────────
            let ch = match cell.text.chars().next() {
                Some(c) if !c.is_whitespace() => c,
                _ => continue,
            };
            let (face_idx, glyph_id) = resolve_glyph(&faces, ch);
            let font = match faces[face_idx].font_ref() {
                Some(f) => f,
                None => continue,
            };

            let mut scaler = ctx
                .builder(font)
                .size(opts.font_size as f32)
                .hint(true)
                .build();

            let image = Render::new(&[
                Source::ColorOutline(0),
                Source::ColorBitmap(StrikeWith::BestFit),
                Source::Outline,
            ])
            .format(Format::Alpha)
            .embolden(if cell.bold { 1.0 } else { 0.0 })
            .render(&mut scaler, glyph_id);

            let image = match image {
                Some(img) => img,
                None => continue,
            };

            let (fr, fg, fb) = if cell.fg >= 0 {
                unpack(cell.fg as u32)
            } else {
                unpack(opts.default_fg)
            };

            // swash placement: `left`/`top` are offsets from the pen origin,
            // `top` measured up from the baseline. Pen sits at the cell's
            // left edge, baseline `opts.baseline` px below the cell top.
            let pen_x = x0;
            let pen_y = y0 + opts.baseline as i64;
            let gx = pen_x + image.placement.left as i64;
            let gy = pen_y - image.placement.top as i64;
            let gw = image.placement.width as i64;
            let gh = image.placement.height as i64;

            match image.content {
                Content::Mask => {
                    for ry in 0..gh {
                        for rx in 0..gw {
                            let a = image.data[(ry * gw + rx) as usize];
                            if a == 0 {
                                continue;
                            }
                            let px = gx + rx;
                            let py = gy + ry;
                            if px < 0 || py < 0 || px >= width as i64 || py >= height as i64 {
                                continue;
                            }
                            let i = ((py as usize) * width + px as usize) * 4;
                            blend(&mut buf[i..i + 4], fr, fg, fb, a);
                        }
                    }
                }
                Content::SubpixelMask | Content::Color => {
                    for ry in 0..gh {
                        for rx in 0..gw {
                            let base = ((ry * gw + rx) * 4) as usize;
                            let r = image.data[base];
                            let g = image.data[base + 1];
                            let b = image.data[base + 2];
                            let a = image.data[base + 3];
                            if a == 0 {
                                continue;
                            }
                            let px = gx + rx;
                            let py = gy + ry;
                            if px < 0 || py < 0 || px >= width as i64 || py >= height as i64 {
                                continue;
                            }
                            let i = ((py as usize) * width + px as usize) * 4;
                            // Color glyphs (emoji) carry their own RGB; mask-
                            // style subpixel coverage is tinted with the fg.
                            if image.content == Content::Color {
                                blend(&mut buf[i..i + 4], r, g, b, a);
                            } else {
                                blend(&mut buf[i..i + 4], fr, fg, fb, a);
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(SwashBitmap {
        pixels: buf.into(),
        width: width as u32,
        height: height as u32,
    })
}
