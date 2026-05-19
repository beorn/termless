/**
 * Real-fidelity canvas screenshot renderer for termless.
 *
 * Drives [ghostty-web](https://npm.im/ghostty-web)'s `CanvasRenderer` (Ghostty's
 * actual renderer compiled to WASM) inside a headless playwright Chromium and
 * captures the canvas as a PNG. This is the "Visual Eyes" rendering path —
 * fast, deterministic, font-bundle-controlled, and visually equivalent to what
 * a user sees in a modern terminal (truecolor, em-dashes, box-drawing,
 * powerline glyphs when an appropriate font is provided).
 *
 * Compared to `screenshotPlaywrightPng` (SVG → Chromium): this path bypasses
 * SVG entirely and feeds raw ANSI directly into ghostty-web's parser, so the
 * renderer sees identical bytes a real Ghostty would. SVG output is per-cell;
 * canvas output is per-glyph from a real GPU-style raster — different
 * fidelity contract.
 *
 * Both `playwright` and `ghostty-web` are loaded lazily. The function throws a
 * clear install hint if either is missing.
 *
 * @see ../docs/guide/canvas-renderer.md
 */

import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import type {
  Cell,
  CursorState,
  PlaywrightBrowserLike,
  PlaywrightModuleLike,
  RGB,
  TerminalReadable,
} from "./types.ts"

// ── Types ──

export interface CanvasScreenshotOptions {
  /** Canvas columns (default: cols of the source if discoverable, else 100). */
  cols?: number
  /** Canvas rows (default: rows of the source if discoverable, else 40). */
  rows?: number
  /** Font size in CSS pixels (default: 16). */
  fontSize?: number
  /**
   * Font family list as a CSS string. If `fontPath` is given, that font is
   * bundled as the first family in the list. Default: "Menlo, monospace".
   */
  fontFamily?: string
  /**
   * Path to a .ttf/.otf file to bundle as a `@font-face` source. When set,
   * the font is registered under family name "TermlessCanvasFont" and added
   * as the first family in the render. Most cleanly: an Iosevka Nerd Font Mono
   * binary so box-drawing and powerline glyphs render.
   */
  fontPath?: string
  /**
   * Theme. Defaults to Tokyo Night Storm — same palette the spike validated
   * against. Override individual fields; missing fields fall through to the
   * default.
   */
  theme?: CanvasTheme
  /** Device pixel ratio. Default: 2 for retina-quality output. */
  dpr?: number
  /** Cursor style. Default: "block". */
  cursorStyle?: "block" | "underline" | "beam"
  /** Whether the cursor blinks (purely cosmetic for a single shot). */
  cursorBlink?: boolean
  /** Whether to hide the cursor in the screenshot. Default: false. */
  hideCursor?: boolean
  /** Playwright `chromium.launch()` options. Typed `unknown` to keep optional. */
  launchOptions?: unknown
  /** Inject an already-loaded Playwright module. Mostly for tests. */
  playwright?: PlaywrightModuleLike
  /**
   * If true, returns extra metadata alongside the PNG (canvas dimensions,
   * measured cell metrics, dpr). For diagnostics / Phase 2 frame-trace.
   */
  returnMeta?: boolean
  /**
   * Override the per-cell pixel metrics measured by ghostty-web. ghostty-web's
   * `measureFont` uses `Math.ceil(actualBoundingBoxAscent + actualBoundingBoxDescent) + 2`
   * which adds a constant 2-pixel padding row — this is generous compared to
   * real Ghostty's line-height-derived metric and produces a render that's ~1
   * physical row taller than the equivalent Ghostty screenshot at the same
   * point size.
   *
   * Provide `cellWidth` / `cellHeight` (logical CSS pixels, pre-DPR) to
   * override the ghostty-web measurement and pin the canvas to a specific
   * geometry. Typical use: matching a reference screenshot's aspect ratio
   * in visual-regression tests.
   *
   * If only one axis is specified, the other is left to the renderer's
   * measurement. Set both to lock the geometry exactly.
   */
  cellWidth?: number
  cellHeight?: number
  /**
   * Final-size override applied after rasterization. When the canvas cell
   * metrics quantize to integer pixels but the reference uses fractional
   * pixel heights (e.g. real Ghostty's 10pt FiraMono is ~10.5px/row), force
   * the captured PNG to an exact target size with a high-quality resample.
   *
   * Provide both width and height in physical pixels. The PNG is resampled
   * via macOS `sips`. Only takes effect on darwin; ignored elsewhere.
   */
  targetWidth?: number
  targetHeight?: number
  /**
   * Raw ANSI bytes to feed directly to ghostty-web, bypassing the
   * `cellsToAnsi(terminal)` serialization step.
   *
   * Why this exists: when the source `terminal` is an xterm.js-backed
   * Terminal, `cellsToAnsi` re-serializes xterm.js's parsed cell grid as
   * ANSI for ghostty-web to re-parse. Parser disagreements between xterm.js
   * and ghostty-web (most notably nerd-font glyph handling — xterm.js
   * splits some single-cell PUA glyphs into two cells with the same
   * character) get baked into the cells before they reach ghostty-web.
   *
   * For maximum fidelity to a real Ghostty render, capture the raw bytes
   * fed to the source terminal and pass them as `rawAnsi`. ghostty-web
   * will parse those bytes directly with the same VT engine real Ghostty
   * uses, eliminating the round-trip through xterm.js's parser.
   *
   * The `terminal` argument is still consulted for cursor position and
   * dimension inference; only the cell→ANSI step is skipped.
   */
  rawAnsi?: string
}

export interface CanvasTheme {
  background?: string
  foreground?: string
  cursor?: string
  cursorAccent?: string
  selectionBackground?: string
  selectionForeground?: string
  black?: string
  red?: string
  green?: string
  yellow?: string
  blue?: string
  magenta?: string
  cyan?: string
  white?: string
  brightBlack?: string
  brightRed?: string
  brightGreen?: string
  brightYellow?: string
  brightBlue?: string
  brightMagenta?: string
  brightCyan?: string
  brightWhite?: string
}

export interface CanvasScreenshotMeta {
  width: number
  height: number
  charWidth: number
  charHeight: number
  dpr: number
}

// ── Tokyo Night Storm default theme ──

const DEFAULT_THEME: Required<CanvasTheme> = {
  background: "#1a1b26",
  foreground: "#c0caf5",
  cursor: "#c0caf5",
  cursorAccent: "#1a1b26",
  selectionBackground: "#33467c",
  selectionForeground: "#c0caf5",
  black: "#15161e",
  red: "#f7768e",
  green: "#9ece6a",
  yellow: "#e0af68",
  blue: "#7aa2f7",
  magenta: "#bb9af7",
  cyan: "#7dcfff",
  white: "#a9b1d6",
  brightBlack: "#414868",
  brightRed: "#f7768e",
  brightGreen: "#9ece6a",
  brightYellow: "#e0af68",
  brightBlue: "#7aa2f7",
  brightMagenta: "#bb9af7",
  brightCyan: "#7dcfff",
  brightWhite: "#c0caf5",
}

// ── Lazy module loaders ──

let playwrightModule: PlaywrightModuleLike | null = null
async function loadPlaywright(): Promise<PlaywrightModuleLike> {
  if (playwrightModule) return playwrightModule
  try {
    const moduleName = "playwright"
    playwrightModule = (await import(moduleName)) as PlaywrightModuleLike
    return playwrightModule
  } catch (cause) {
    throw new Error(
      "screenshotCanvasPng() requires the optional playwright package. Install it:\n" +
        "  bun add -d playwright",
      { cause },
    )
  }
}

interface GhosttyWebAssets {
  jsBytes: Uint8Array
  wasmBytes: Uint8Array
}

let ghosttyWebAssetsCache: GhosttyWebAssets | null = null
async function loadGhosttyWebAssets(): Promise<GhosttyWebAssets> {
  if (ghosttyWebAssetsCache) return ghosttyWebAssetsCache
  try {
    // Resolve via createRequire — works under Bun + Node, and through
    // vitest's module runner (which intercepts import.meta.resolve).
    // The default resolve returns the CJS UMD entry; we need the ESM
    // entry so the page can `import { CanvasRenderer }` by name.
    const req = createRequire(import.meta.url)
    // Resolve via the wasm subpath (always exported) and walk up to package
    // root — avoids needing "./package.json" to be in the package's exports.
    const wasmPath = req.resolve("ghostty-web/ghostty-vt.wasm")
    const pkgRoot = wasmPath.slice(0, wasmPath.length - "/ghostty-vt.wasm".length)
    const pkgJsonPath = `${pkgRoot}/package.json`
    const pkgJson = JSON.parse((await readFile(pkgJsonPath)).toString())
    const esmRel: string = pkgJson.exports?.["."]?.import ?? pkgJson.module ?? pkgJson.main
    if (!esmRel) throw new Error("ghostty-web: no ESM export entry resolvable from package.json")
    const jsPath = `${pkgRoot}/${esmRel.replace(/^\.\//, "")}`
    const [jsBytes, wasmBytes] = await Promise.all([readFile(jsPath), readFile(wasmPath)])
    ghosttyWebAssetsCache = { jsBytes, wasmBytes }
    return ghosttyWebAssetsCache
  } catch (cause) {
    throw new Error(
      "screenshotCanvasPng() requires the optional ghostty-web package. Install it:\n" +
        "  bun add -d ghostty-web",
      { cause },
    )
  }
}

// ── Cells → ANSI serializer ──

function rgbToSgr(role: "fg" | "bg", color: RGB): string {
  const code = role === "fg" ? 38 : 48
  return `${code};2;${color.r};${color.g};${color.b}`
}

interface SgrState {
  fg: RGB | null
  bg: RGB | null
  bold: boolean
  dim: boolean
  italic: boolean
  underline: Cell["underline"]
  strikethrough: boolean
  inverse: boolean
  hidden: boolean
}

const INITIAL_SGR: SgrState = {
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  strikethrough: false,
  inverse: false,
  hidden: false,
}

function sgrFor(cell: Cell): SgrState {
  return {
    fg: cell.fg,
    bg: cell.bg,
    bold: cell.bold,
    dim: cell.dim,
    italic: cell.italic,
    underline: cell.underline,
    strikethrough: cell.strikethrough,
    inverse: cell.inverse,
    hidden: cell.hidden,
  }
}

function sgrCodesBetween(prev: SgrState, next: SgrState): string {
  // If anything turns off, just emit a full reset + reapply the active set.
  const turnedOff =
    (prev.bold && !next.bold) ||
    (prev.dim && !next.dim) ||
    (prev.italic && !next.italic) ||
    (prev.underline && !next.underline) ||
    (prev.strikethrough && !next.strikethrough) ||
    (prev.inverse && !next.inverse) ||
    (prev.hidden && !next.hidden) ||
    (prev.fg !== null && next.fg === null) ||
    (prev.bg !== null && next.bg === null)
  const parts: string[] = []
  if (turnedOff) {
    parts.push("0")
    if (next.bold) parts.push("1")
    if (next.dim) parts.push("2")
    if (next.italic) parts.push("3")
    if (next.underline) parts.push("4")
    if (next.inverse) parts.push("7")
    if (next.hidden) parts.push("8")
    if (next.strikethrough) parts.push("9")
    if (next.fg) parts.push(rgbToSgr("fg", next.fg))
    if (next.bg) parts.push(rgbToSgr("bg", next.bg))
  } else {
    if (!prev.bold && next.bold) parts.push("1")
    if (!prev.dim && next.dim) parts.push("2")
    if (!prev.italic && next.italic) parts.push("3")
    if (!prev.underline && next.underline) parts.push("4")
    if (!prev.inverse && next.inverse) parts.push("7")
    if (!prev.hidden && next.hidden) parts.push("8")
    if (!prev.strikethrough && next.strikethrough) parts.push("9")
    if (!rgbEqual(prev.fg, next.fg) && next.fg) parts.push(rgbToSgr("fg", next.fg))
    if (!rgbEqual(prev.bg, next.bg) && next.bg) parts.push(rgbToSgr("bg", next.bg))
  }
  if (parts.length === 0) return ""
  return `\x1b[${parts.join(";")}m`
}

function rgbEqual(a: RGB | null, b: RGB | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.r === b.r && a.g === b.g && a.b === b.b
}

/**
 * Serialize a TerminalReadable's cell grid back to ANSI escape sequences.
 *
 * This is the inverse of "feed bytes → parse → cells": given a snapshot of
 * the cell grid, produce bytes that — when fed to a fresh terminal — produce
 * the same visible state. Used to bridge a TerminalReadable into ghostty-web's
 * parser so the canvas renderer sees real Ghostty-shaped state.
 *
 * Note: this is a *visual* serialization. It doesn't preserve cursor moves,
 * scroll history, or original SGR sequencing — just the final visible grid.
 */
export function cellsToAnsi(terminal: TerminalReadable, opts: { rows?: number; cols?: number } = {}): string {
  const lines = terminal.getLines()
  const rowCount = opts.rows ?? lines.length
  // Use only the last `rowCount` rows to match a screen-shaped render.
  const screenRows = lines.slice(Math.max(0, lines.length - rowCount))
  const colCount = opts.cols ?? screenRows[0]?.length ?? 0
  const cursor: CursorState | null = (() => {
    try {
      return terminal.getCursor()
    } catch {
      return null
    }
  })()

  let prev: SgrState = INITIAL_SGR
  // Deterministic starting state for the downstream parser:
  //   \x1b[H     — cursor home (1,1)
  //   \x1b[2J    — clear entire display
  //   \x1b[?7l   — DECAWM off: writing exactly `cols` chars to a row
  //                 must NOT enter the pending-wrap state. xterm.js handles
  //                 the spec-correct DECAWM+CRLF interaction, but ghostty-web
  //                 (in canvas-render's headless playwright path) double-
  //                 advances when a row fills the right margin and the next
  //                 byte is CR — losing the top N rows of the buffer when
  //                 every row emits exactly cols glyphs.
  //   \x1b[?25l  — hide cursor so the cursor box doesn't paint over content
  let out = "\x1b[H\x1b[2J\x1b[?7l\x1b[?25l"
  for (let r = 0; r < screenRows.length; r++) {
    const row = screenRows[r]
    for (let c = 0; c < colCount; c++) {
      const cell = row[c]
      if (!cell) {
        // Blank cell — emit space with default attrs (after a reset if needed).
        if (prev !== INITIAL_SGR && nonDefault(prev)) {
          out += "\x1b[0m"
          prev = INITIAL_SGR
        }
        out += " "
        continue
      }
      if (cell.continuation) continue // wide-char trailing cell — skip
      const next = sgrFor(cell)
      out += sgrCodesBetween(prev, next)
      out += cell.char.length > 0 ? cell.char : " "
      prev = next
    }
    if (r < screenRows.length - 1) {
      // Reset + CRLF at row boundary so colors don't bleed into next line.
      out += "\x1b[0m\r\n"
      prev = INITIAL_SGR
    }
  }
  // Trailing reset.
  out += "\x1b[0m"
  // Position cursor.
  if (cursor && cursor.x >= 0 && cursor.y >= 0) {
    // ANSI is 1-indexed.
    out += `\x1b[${cursor.y + 1};${cursor.x + 1}H`
  }
  return out
}

function nonDefault(s: SgrState): boolean {
  return (
    s.bold ||
    s.dim ||
    s.italic ||
    !!s.underline ||
    s.strikethrough ||
    s.inverse ||
    s.hidden ||
    s.fg !== null ||
    s.bg !== null
  )
}

// ── HTML template ──

function buildHtml(opts: {
  ansi: string
  cols: number
  rows: number
  fontSize: number
  fontFamily: string
  hasBundledFont: boolean
  bundledFontName: string
  theme: Required<CanvasTheme>
  dpr: number
  cursorStyle: "block" | "underline" | "beam"
  cursorBlink: boolean
  hideCursor: boolean
  cellWidth?: number
  cellHeight?: number
}): string {
  const themeJson = JSON.stringify(opts.theme)
  const ansiJson = JSON.stringify(opts.ansi)
  const familyDecl = opts.hasBundledFont
    ? `@font-face { font-family: "${opts.bundledFontName}"; src: url("./font") format("truetype"); font-display: block; }`
    : ""
  const fontFamily = opts.hasBundledFont ? `${opts.bundledFontName}, ${opts.fontFamily}` : opts.fontFamily
  // After `remeasureFont()`, the renderer's `metrics` field is populated with
  // {width, height, baseline}. To pin cell geometry to a reference (for
  // visual-regression tests), we override the measured values BEFORE the
  // first `resize()` call. ghostty-web's `measureFont` adds +2 px of vertical
  // padding which makes cells slightly taller than real Ghostty's; an
  // explicit override removes that drift while preserving glyph fidelity.
  const cellOverride: string[] = []
  if (opts.cellWidth != null) cellOverride.push(`renderer.metrics.width = ${opts.cellWidth};`)
  if (opts.cellHeight != null) {
    cellOverride.push(`renderer.metrics.height = ${opts.cellHeight};`)
    // Keep the baseline proportional so glyphs sit correctly within the
    // overridden cell. Default baseline = ceil(ascent)+1; for a square-ish
    // cell, ~0.8 * height is a sane fallback.
    cellOverride.push(`renderer.metrics.baseline = Math.min(renderer.metrics.baseline, ${opts.cellHeight} - 1);`)
  }
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8" />
<style>
  ${familyDecl}
  html, body { margin: 0; background: ${opts.theme.background}; }
  #target { display: block; }
  /* Match real Ghostty's font rendering: subpixel-antialiased glyphs.
     Without explicit smoothing, Chromium defaults to a different LCD/grayscale
     mix that subtly shifts glyph weight vs Ghostty's Core Text path. */
  canvas { -webkit-font-smoothing: antialiased; font-smooth: always; }
</style>
</head><body>
<canvas id="target"></canvas>
<script type="module">
  import { Ghostty, CanvasRenderer } from "./ghostty-web.js";
  const canvas = document.getElementById("target");
  try {
    ${opts.hasBundledFont ? `await document.fonts.load("${opts.fontSize}px ${opts.bundledFontName}"); await document.fonts.ready;` : ""}
    const ghostty = await Ghostty.load("./ghostty-vt.wasm");
    const cols = ${opts.cols}, rows = ${opts.rows};
    const terminal = ghostty.createTerminal(cols, rows);
    const renderer = new CanvasRenderer(canvas, {
      fontSize: ${opts.fontSize},
      fontFamily: ${JSON.stringify(fontFamily)},
      cursorStyle: ${JSON.stringify(opts.cursorStyle)},
      cursorBlink: ${opts.cursorBlink},
      theme: ${themeJson},
    });
    // Force the canvas 2D context to render text with high-quality
    // geometric placement before ghostty-web measures + draws. Chromium's
    // default text-rendering on a 2D context is "auto", which biases toward
    // speed and emits subtly different glyph positions than real Ghostty's
    // Core Text path. Setting "geometricPrecision" matches Ghostty's
    // per-cell integer-offset draw model and reduces dHash drift in the
    // bottom rows (small glyphs + status-bar icons are the most sensitive).
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.font = "${opts.fontSize}px " + ${JSON.stringify(fontFamily)};
      // textRendering is a newer Canvas 2D property (Chromium ≥ 100). Guard
      // with a typeof check so older Chromium versions don't throw.
      if ("textRendering" in ctx) {
        (ctx).textRendering = "geometricPrecision";
      }
      // Force the highest-quality image resampler when ghostty-web's
      // glyph atlas blits cells to the canvas.
      if ("imageSmoothingQuality" in ctx) {
        (ctx).imageSmoothingQuality = "high";
      }
    }
    renderer.remeasureFont();
    ${cellOverride.join("\n    ")}
    renderer.resize(cols, rows);
    renderer.setCursorBlink(${opts.cursorBlink});
    ${opts.hideCursor ? "if (typeof renderer.setCursorVisible === 'function') renderer.setCursorVisible(false);" : ""}
    terminal.write(${ansiJson});
    terminal.update();
    renderer.render(terminal, true);
    window.__canvasMeta = {
      width: canvas.width, height: canvas.height,
      charWidth: renderer.charWidth, charHeight: renderer.charHeight,
      dpr: window.devicePixelRatio,
    };
    window.__canvasReady = true;
  } catch (err) {
    window.__canvasError = String(err && err.stack ? err.stack : err);
    console.error(err);
  }
</script>
</body></html>`
}

function asUint8Array(bytes: Uint8Array | ArrayBuffer): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
}

/**
 * Resample a PNG buffer to a target physical pixel size.
 *
 * Uses macOS `sips` when available (good Lanczos-quality resampler that's
 * always present on darwin and matches Quartz's image-event behavior). On
 * other platforms, returns the input bytes unchanged — the caller takes
 * responsibility for resizing.
 *
 * This is the post-render escape hatch for fractional-pixel cell heights
 * (see `targetWidth` / `targetHeight` option for the full rationale).
 */
async function resamplePngTo(png: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  if (process.platform !== "darwin") return png
  const { spawnSync } = await import("node:child_process")
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const tmp = mkdtempSync(join(tmpdir(), "canvas-resize-"))
  try {
    const inPath = join(tmp, "in.png")
    const outPath = join(tmp, "out.png")
    writeFileSync(inPath, png)
    // sips -z <height> <width> — note the height-first argument order.
    const r = spawnSync("sips", ["-z", String(height), String(width), inPath, "--out", outPath], { stdio: "ignore" })
    if (r.status !== 0) {
      // Resize failed — return original. The caller decides whether to
      // treat a geometry mismatch as a test failure.
      return png
    }
    return new Uint8Array(readFileSync(outPath))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

// ── Public API ──

/**
 * Render a terminal screenshot as PNG via ghostty-web's CanvasRenderer in
 * headless playwright Chromium. The output is visually equivalent to a real
 * Ghostty render — truecolor, real font shaping, real cell metrics — but
 * runs deterministically inside a CI or sub-second iteration loop.
 *
 * Both `playwright` and `ghostty-web` are loaded lazily. If either is
 * missing the function throws a clear install hint.
 *
 * Usage:
 * ```ts
 * const png = await screenshotCanvasPng(terminal, {
 *   cols: 100, rows: 40,
 *   fontPath: "/Users/me/Library/Fonts/IosevkaNerdFontMono-Regular.ttf",
 * })
 * ```
 */
export async function screenshotCanvasPng(
  terminal: TerminalReadable,
  options?: CanvasScreenshotOptions,
): Promise<Uint8Array>
export async function screenshotCanvasPng(
  terminal: TerminalReadable,
  options: CanvasScreenshotOptions & { returnMeta: true },
): Promise<{ png: Uint8Array; meta: CanvasScreenshotMeta }>
export async function screenshotCanvasPng(
  terminal: TerminalReadable,
  options: CanvasScreenshotOptions = {},
): Promise<Uint8Array | { png: Uint8Array; meta: CanvasScreenshotMeta }> {
  const cols = options.cols ?? inferCols(terminal) ?? 100
  const rows = options.rows ?? inferRows(terminal) ?? 40
  const fontSize = options.fontSize ?? 16
  const fontFamily = options.fontFamily ?? "Menlo, monospace"
  const theme: Required<CanvasTheme> = { ...DEFAULT_THEME, ...(options.theme ?? {}) }
  const dpr = options.dpr ?? 2
  const cursorStyle = options.cursorStyle ?? "block"
  const cursorBlink = options.cursorBlink ?? false
  const hideCursor = options.hideCursor ?? false

  // Load bundled font if requested.
  const hasBundledFont = !!options.fontPath
  const bundledFontName = "TermlessCanvasFont"
  let fontBytes: Buffer | null = null
  if (hasBundledFont) {
    if (!existsSync(options.fontPath!)) {
      throw new Error(`screenshotCanvasPng(): fontPath does not exist: ${options.fontPath}`)
    }
    fontBytes = await readFile(options.fontPath!)
  }

  // Cells → ANSI. When `rawAnsi` is provided, skip the cellsToAnsi
  // round-trip — ghostty-web will parse the original bytes directly,
  // matching what real Ghostty would see. See the `rawAnsi` field doc on
  // `CanvasScreenshotOptions` for the parser-disagreement rationale.
  //
  // The preamble (\x1b[H \x1b[2J \x1b[?7l \x1b[?25l) is still prepended so
  // ghostty-web starts from a known state (home + clear + DECAWM-off +
  // cursor-hide); without DECAWM-off, exactly-cols-wide rows trigger
  // ghostty-web's pending-wrap and drop the top N rows.
  const ansi = options.rawAnsi != null
    ? "\x1b[H\x1b[2J\x1b[?7l\x1b[?25l" + options.rawAnsi
    : cellsToAnsi(terminal, { cols, rows })

  // Load assets.
  const { jsBytes, wasmBytes } = await loadGhosttyWebAssets()

  // Build HTML.
  const html = buildHtml({
    ansi,
    cols,
    rows,
    fontSize,
    fontFamily,
    hasBundledFont,
    bundledFontName,
    theme,
    dpr,
    cursorStyle,
    cursorBlink,
    hideCursor,
    cellWidth: options.cellWidth,
    cellHeight: options.cellHeight,
  })

  // Launch + route.
  const playwright = options.playwright ?? (await loadPlaywright())
  let browser: PlaywrightBrowserLike
  try {
    browser = await playwright.chromium.launch(options.launchOptions)
  } catch (cause) {
    throw new Error(
      "screenshotCanvasPng() could not launch Chromium. If Playwright browsers are missing, install them:\n" +
        "  bunx playwright install chromium",
      { cause },
    )
  }

  // Spin up a tiny node:http server to serve the inlined HTML + ghostty-web
  // JS / WASM + bundled font. Using a real HTTP base URL (vs about:blank +
  // page.route()) avoids ESM resolution quirks in setContent contexts.
  const server = createServer((req, res) => {
    const url = req.url ?? "/"
    if (url === "/" || url.startsWith("/index")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end(html)
      return
    }
    if (url.endsWith("/ghostty-web.js") || url === "/ghostty-web.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" })
      res.end(Buffer.from(jsBytes))
      return
    }
    if (url.endsWith("/ghostty-vt.wasm") || url === "/ghostty-vt.wasm") {
      res.writeHead(200, { "Content-Type": "application/wasm" })
      res.end(Buffer.from(wasmBytes))
      return
    }
    if ((url === "/font" || url.endsWith("/font")) && fontBytes) {
      res.writeHead(200, { "Content-Type": "font/ttf" })
      res.end(fontBytes)
      return
    }
    res.writeHead(404).end("not found")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const addr = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${addr.port}`

  try {
    // Approximate viewport at native size; oversize so the canvas isn't clipped.
    const cellWidthGuess = Math.ceil(fontSize * 0.6)
    const cellHeightGuess = Math.ceil(fontSize * 1.25)
    const viewportWidth = Math.max(800, cols * cellWidthGuess + 64)
    const viewportHeight = Math.max(400, rows * cellHeightGuess + 64)
    const page = await browser.newPage({
      viewport: { width: viewportWidth, height: viewportHeight },
      deviceScaleFactor: dpr,
    })

    const pageWithGoto = page as unknown as {
      goto: (url: string, opts?: { waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit" }) => Promise<unknown>
      on?: (event: string, handler: (...args: unknown[]) => void) => void
    }
    if (typeof pageWithGoto.goto !== "function") {
      throw new Error("screenshotCanvasPng(): page.goto() unavailable on this Playwright build")
    }
    // Capture page-side errors so failures surface instead of timing out
    // silently. Use TERMLESS_CANVAS_DEBUG=1 to also print console messages.
    const debugCanvas = process.env.TERMLESS_CANVAS_DEBUG === "1"
    if (typeof pageWithGoto.on === "function") {
      pageWithGoto.on("pageerror", (...args: unknown[]) => {
        const err = args[0] as { message?: string; stack?: string } | undefined
        // eslint-disable-next-line no-console
        console.error("[canvas-render:pageerror]", err?.message ?? err, err?.stack ?? "")
      })
      if (debugCanvas) {
        pageWithGoto.on("console", (...args: unknown[]) => {
          const msg = args[0] as { type?: () => string; text?: () => string } | undefined
          // eslint-disable-next-line no-console
          console.error(`[canvas-render:${msg?.type?.() ?? "log"}]`, msg?.text?.() ?? "")
        })
      }
    }
    await pageWithGoto.goto(`${baseUrl}/index.html`, { waitUntil: "load" })

    // Wait for render OR error.
    const waitForFunction = (page as unknown as { waitForFunction?: (fn: () => boolean, arg?: unknown, opts?: unknown) => Promise<unknown> }).waitForFunction
    if (typeof waitForFunction !== "function") {
      throw new Error("screenshotCanvasPng(): page.waitForFunction() unavailable")
    }
    await waitForFunction.call(
      page,
      () => (window as unknown as { __canvasReady?: boolean; __canvasError?: string }).__canvasReady === true ||
        (window as unknown as { __canvasError?: string }).__canvasError != null,
      undefined,
      { timeout: 15_000 },
    )
    const err = await page.evaluate?.(() => (window as unknown as { __canvasError?: string }).__canvasError)
    if (err) {
      throw new Error(`screenshotCanvasPng(): canvas render failed in page:\n${err}`)
    }
    const meta = (await page.evaluate?.(() => (window as unknown as { __canvasMeta?: CanvasScreenshotMeta }).__canvasMeta)) ?? {
      width: 0,
      height: 0,
      charWidth: 0,
      charHeight: 0,
      dpr,
    }

    const locator = (page as unknown as { locator: (sel: string) => { screenshot: (opts?: { type?: "png" }) => Promise<Uint8Array | ArrayBuffer> } }).locator
    const canvasLocator = locator.call(page, "#target")
    let shot = asUint8Array(await canvasLocator.screenshot({ type: "png" }))

    // Post-render resample to target dimensions when requested. This is the
    // escape hatch for fractional-pixel cell heights — ghostty-web measures
    // glyph metrics as ceil(ascent+descent)+2 which quantizes to an integer
    // pixel height, while real Ghostty's cell height (line-height-derived)
    // can land between two integers. For visual-regression tests the cleanest
    // fix is a single high-quality resample to the reference geometry.
    if (options.targetWidth != null && options.targetHeight != null) {
      shot = await resamplePngTo(shot, options.targetWidth, options.targetHeight)
      meta.width = options.targetWidth
      meta.height = options.targetHeight
    }

    if (options.returnMeta) return { png: shot, meta }
    return shot
  } finally {
    await browser.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

// ── Inference helpers ──

function inferCols(terminal: TerminalReadable): number | null {
  try {
    const lines = terminal.getLines()
    if (lines.length === 0) return null
    return lines[lines.length - 1].length || null
  } catch {
    return null
  }
}

function inferRows(terminal: TerminalReadable): number | null {
  try {
    const lines = terminal.getLines()
    return lines.length || null
  } catch {
    return null
  }
}
