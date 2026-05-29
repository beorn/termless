/**
 * `@termless/swash-render` — pure-native swash text rasterizer for termless.
 *
 * swash (github.com/dfrg/swash — the cosmic-text / Linebender lineage) is a
 * pure-Rust, browser-grade headless text rasterizer: full shaping, TrueType +
 * CFF outlines, and **color emoji** across sbix / CBDT / COLR. termless's
 * `canvas` (Skia via `@napi-rs/canvas`) and `resvg` renderers both lose the
 * system color-emoji table and fall back to monochrome line-art; swash reads
 * the color tables directly, so 📁 / 📋 / ✅ render in full color.
 *
 * This package is the **cell-grid path**: swash does shaping + glyph
 * rasterization only, so the binding ports the fixed-pitch grid walk (per-cell
 * fg/bg, wide-char advance) — see `native/src/lib.rs`. termless already owns
 * the cell grid (it feeds both canvas and resvg), so the public entry point
 * here is {@link renderCells}: a {@link TerminalReadable} in, RGBA out.
 *
 * The native `.node` binary must be built first (phase 1 ships macOS-arm64;
 * cross-platform prebuilds are a later phase):
 *
 *   cd packages/swash-render && bun run build:native && bun run postbuild:native
 */

import { createRequire } from "node:module"
import { bundledFontFiles } from "../../../src/render/fonts.ts"
import { readFileSync, existsSync } from "node:fs"
import type { TerminalReadable, Cell, RGB } from "../../../src/terminal/types.ts"

// ===========================================================================
// Native module
// ===========================================================================

/** A single cell flattened for the napi boundary. */
export interface SwashCell {
  text: string
  /** Packed `0xRRGGBB`, or `-1` for "default fg". */
  fg: number
  /** Packed `0xRRGGBB`, or `-1` for "default bg". */
  bg: number
  bold: boolean
  wide: boolean
  continuation: boolean
}

/** One font in the fallback chain. */
export interface SwashFont {
  data: Buffer
  index: number
}

/** Inputs for one {@link nativeRender} call. */
export interface SwashRenderOptions {
  cells: SwashCell[]
  cols: number
  rows: number
  cellWidth: number
  cellHeight: number
  fontSize: number
  baseline: number
  fonts: SwashFont[]
  /** Default fg `0xRRGGBB`. */
  defaultFg: number
  /** Default bg `0xRRGGBB`. */
  defaultBg: number
  padding: number
}

/** An RGBA bitmap produced by the swash renderer. */
export interface SwashBitmap {
  pixels: Buffer
  width: number
  height: number
}

interface NativeModule {
  render(opts: SwashRenderOptions): SwashBitmap
}

let nativeModule: NativeModule | null = null
let loadError: Error | null = null

function isFileMusl(path: string): boolean {
  return path.includes("libc.musl-") || path.includes("ld-musl-")
}

function isMuslLinux(): boolean {
  if (process.platform !== "linux") return false
  try {
    if (readFileSync("/usr/bin/ldd", "utf8").includes("musl")) return true
  } catch {
    // Fall through to Node's process report when /usr/bin/ldd is absent.
  }
  const report =
    typeof process.report?.getReport === "function"
      ? (process.report.getReport() as { header?: { glibcVersionRuntime?: string }; sharedObjects?: string[] })
      : null
  if (report?.header && "glibcVersionRuntime" in report.header) return false
  if (Array.isArray(report?.sharedObjects)) return report.sharedObjects.some(isFileMusl)
  return false
}

function nativePlatformSuffix(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
  musl = isMuslLinux(),
): string | null {
  if (platform === "darwin") {
    if (arch === "arm64") return "darwin-arm64"
    if (arch === "x64") return "darwin-x64"
  }
  if (platform === "win32") {
    if (arch === "arm64") return "win32-arm64-msvc"
    if (arch === "x64") return "win32-x64-msvc"
  }
  if (platform === "linux") {
    const abi = musl ? "musl" : "gnu"
    if (arch === "arm64") return `linux-arm64-${abi}`
    if (arch === "x64") return `linux-x64-${abi}`
  }
  return null
}

function nativeLoadCandidates(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
  musl = isMuslLinux(),
): string[] {
  const candidates = ["../termless-swash-render.node"]
  const suffix = nativePlatformSuffix(platform, arch, musl)
  if (suffix) {
    candidates.push(`../termless-swash-render.${suffix}.node`)
    candidates.push(`@termless/swash-render-${suffix}`)
  }
  return candidates
}

/** @internal — exposed for loader contract tests. */
export function _swashNativeLoadCandidatesForTesting(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
  musl = false,
): string[] {
  return nativeLoadCandidates(platform, arch, musl)
}

/** @internal — reset cached load state for tests. */
export function _resetSwashRenderNativeForTesting(): void {
  nativeModule = null
  loadError = null
}

/**
 * Load the native swash-render `.node` addon. Throws a clear, actionable
 * error if the binary is missing. Supports the legacy local build
 * (`termless-swash-render.node`), napi-rs platform-suffixed prebuilds, and the
 * optional platform-package layout used by napi-rs native packages.
 */
export function loadSwashRenderNative(): NativeModule {
  if (nativeModule) return nativeModule
  if (loadError) throw loadError
  const require = createRequire(import.meta.url)
  const errors: string[] = []
  const override = process.env.NAPI_RS_NATIVE_LIBRARY_PATH
  if (override) {
    try {
      nativeModule = require(override) as NativeModule
      return nativeModule
    } catch (e) {
      errors.push(`${override}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  for (const candidate of nativeLoadCandidates()) {
    try {
      nativeModule = require(candidate) as NativeModule
      return nativeModule
    } catch (e) {
      errors.push(`${candidate}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const tried = nativeLoadCandidates()
    .map((c) => `  - ${c}`)
    .join("\n")
  const original = errors.length ? `\n\nLoad attempts:\n${errors.map((e) => `  - ${e}`).join("\n")}` : ""
  loadError = new Error(
    "Failed to load @termless/swash-render native module.\n" +
      "Install the matching optional prebuild package, or build a local prebuild:\n" +
      "  cd packages/swash-render && bun run build:prebuild\n\n" +
      `Tried:\n${tried}${original}`,
  )
  throw loadError
}

/** Whether the native swash binding is present and loadable. */
export function swashRenderAvailable(): boolean {
  try {
    loadSwashRenderNative()
    return true
  } catch {
    return false
  }
}

/** Direct native render — low-level. Most callers want {@link renderCells}. */
export function nativeRender(opts: SwashRenderOptions): SwashBitmap {
  return loadSwashRenderNative().render(opts)
}

// ===========================================================================
// Font set
// ===========================================================================

/**
 * The system color-emoji face. swash needs a *color* font for emoji ink;
 * termless's bundled `NotoEmoji-Regular.ttf` is monochrome, so the swash
 * path layers the platform color-emoji face on top of the bundled chain.
 */
function colorEmojiFont(): SwashFont | null {
  const candidates: Array<{ path: string; index: number }> = [
    { path: "/System/Library/Fonts/Apple Color Emoji.ttc", index: 0 },
    { path: "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf", index: 0 },
    { path: "/usr/share/fonts/noto/NotoColorEmoji.ttf", index: 0 },
    { path: "C:\\Windows\\Fonts\\seguiemj.ttf", index: 0 },
  ]
  for (const c of candidates) {
    if (existsSync(c.path)) return { data: readFileSync(c.path), index: c.index }
  }
  return null
}

let cachedFonts: SwashFont[] | null = null

/**
 * The swash font fallback chain.
 *
 * Per-glyph fallback resolves to the *first* face in the chain that covers a
 * codepoint, so order is load-bearing. The platform color-emoji face is
 * inserted **before** the bundled monochrome `NotoEmoji-Regular.ttf` —
 * otherwise the mono face shadows it and emoji render as monochrome ink (the
 * exact failure the spike's control catches). Order:
 *
 *   1. JetBrains Mono       — primary monospace face
 *   2. Noto Sans Symbols 2  — terminal symbol glyphs
 *   3. <platform color emoji> — color emoji (preferred over mono)
 *   4. Noto Emoji (mono)    — emoji fallback when no color face exists
 */
export function swashFontChain(): SwashFont[] {
  if (cachedFonts) return cachedFonts
  const color = colorEmojiFont()
  const fonts: SwashFont[] = []
  for (const file of bundledFontFiles()) {
    // Splice the color-emoji face in just before the bundled mono-emoji face.
    if (color && /NotoEmoji/i.test(file)) {
      fonts.push(color)
    }
    fonts.push({ data: readFileSync(file), index: 0 })
  }
  // If the bundled mono-emoji face was absent, still append the color face.
  if (color && !fonts.includes(color)) fonts.push(color)
  cachedFonts = fonts
  return fonts
}

// ===========================================================================
// Cell-grid path
// ===========================================================================

const DEFAULT_FG = 0xd4d4d4
const DEFAULT_BG = 0x1e1e1e
const DEFAULT_CELL_HEIGHT = 20
const DEFAULT_CELL_WIDTH = 9.6
const DEFAULT_FONT_SIZE_RATIO = 17 / 20
const DEFAULT_BASELINE_RATIO = 0.835

function packRgb(c: RGB | null): number {
  if (!c) return -1
  return ((c.r & 0xff) << 16) | ((c.g & 0xff) << 8) | (c.b & 0xff)
}

/** Flatten a termless {@link Cell} to a {@link SwashCell}, honoring inverse. */
function toSwashCell(cell: Cell): SwashCell {
  let fg = packRgb(cell.fg)
  let bg = packRgb(cell.bg)
  if (cell.inverse) {
    // Inverse swaps fg/bg; a default channel resolves to the theme color so
    // the swap stays visible (otherwise `-1`↔`-1` would be a no-op).
    const f = fg === -1 ? DEFAULT_FG : fg
    const b = bg === -1 ? DEFAULT_BG : bg
    fg = b
    bg = f
  }
  return {
    text: cell.continuation ? "" : cell.char,
    fg,
    bg,
    bold: cell.bold,
    wide: cell.wide,
    continuation: cell.continuation,
  }
}

/** Options for {@link renderCells}. */
export interface RenderCellsOptions {
  /** Cell advance width in px (monospace pitch). Default 9.6. */
  cellWidth?: number
  /** Cell box height in px (line height). Default 20. */
  cellHeight?: number
  /** Glyph render size in px. Default `cellHeight * 0.85`. */
  fontSize?: number
  /** Baseline offset from the cell-box top in px. Default `cellHeight * 0.835`. */
  baseline?: number
  /** Padding on every side in px. Default 0. */
  padding?: number
  /** Default foreground `0xRRGGBB`. Default `0xd4d4d4`. */
  defaultFg?: number
  /** Default background `0xRRGGBB`. Default `0x1e1e1e`. */
  defaultBg?: number
  /** Font fallback chain. Defaults to {@link swashFontChain}. */
  fonts?: SwashFont[]
}

/**
 * Rasterize a terminal's current cell grid into an RGBA bitmap via swash.
 *
 * This is the high-fidelity path: the cell grid is fed straight to swash
 * (no SVG round-trip), so color-emoji glyphs composite their native color
 * bitmaps. Mirrors how `screenshotSvg` reads a {@link TerminalReadable}.
 */
export function renderCells(terminal: TerminalReadable, opts: RenderCellsOptions = {}): SwashBitmap {
  const lines = terminal.getLines()
  const rows = lines.length
  const cols = lines.reduce((m, line) => Math.max(m, line.length), 0)
  const cellHeight = opts.cellHeight ?? DEFAULT_CELL_HEIGHT
  const blank: SwashCell = { text: "", fg: -1, bg: -1, bold: false, wide: false, continuation: false }
  const cells: SwashCell[] = []
  for (let row = 0; row < rows; row++) {
    const line = lines[row] ?? []
    for (let col = 0; col < cols; col++) {
      const cell = line[col]
      cells.push(cell ? toSwashCell(cell) : { ...blank })
    }
  }
  return nativeRender({
    cells,
    cols,
    rows,
    cellWidth: opts.cellWidth ?? DEFAULT_CELL_WIDTH,
    cellHeight,
    fontSize: opts.fontSize ?? cellHeight * DEFAULT_FONT_SIZE_RATIO,
    baseline: opts.baseline ?? cellHeight * DEFAULT_BASELINE_RATIO,
    fonts: opts.fonts ?? swashFontChain(),
    defaultFg: opts.defaultFg ?? DEFAULT_FG,
    defaultBg: opts.defaultBg ?? DEFAULT_BG,
    padding: opts.padding ?? 0,
  })
}
