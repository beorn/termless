/**
 * SVG screenshot renderer for termless.
 *
 * Converts a terminal cell grid (TerminalReadable) into an SVG string.
 * Pure function with no side effects — suitable for snapshots, docs, and debugging.
 *
 * Supports VHS-style visual polish: padding, border radius, window bar
 * (macOS traffic light dots), margin, and margin fill color.
 */

import type {
  TerminalReadable,
  SvgScreenshotOptions,
  SvgTheme,
  Cell,
  RGB,
  CursorState,
  WindowBar,
} from "../terminal/types.ts"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  BUNDLED_FONTS,
  bundledFontsDir,
  BUNDLED_PRIMARY_FAMILY,
  BUNDLED_SYMBOL_FAMILY,
  BUNDLED_NERD_FAMILY,
  BUNDLED_EMOJI_FAMILY,
} from "./fonts.ts"
import { isLikelyEmoji, loadTwemojiSvg, toTwemojiKey } from "./emoji.ts"

// ── Defaults ──

/** font-family stack naming the bundled faces — used when `embedFonts` is set. */
const BUNDLED_FONT_FAMILY = `'${BUNDLED_PRIMARY_FAMILY}', '${BUNDLED_SYMBOL_FAMILY}', '${BUNDLED_NERD_FAMILY}', '${BUNDLED_EMOJI_FAMILY}', 'Menlo', 'Monaco', monospace`

let cachedFontDefs: string | null = null
/**
 * A `<defs><style>` block embedding the bundled fonts as base64 `@font-face`
 * rules. Makes an SVG self-contained — it renders identically in any
 * rasterizer or browser, with no host-font dependency. Cached (the fonts are
 * ~1.8 MB; build the data URIs once per process).
 */
export function embeddedFontFaceDefs(): string {
  if (cachedFontDefs !== null) return cachedFontDefs
  const dir = bundledFontsDir()
  const faces: string[] = []
  for (const { file, family } of BUNDLED_FONTS) {
    try {
      const b64 = readFileSync(join(dir, file)).toString("base64")
      faces.push(`@font-face{font-family:'${family}';src:url(data:font/ttf;base64,${b64});}`)
    } catch {
      // a missing bundled font is non-fatal — skip it
    }
  }
  cachedFontDefs = faces.length > 0 ? `<defs><style>${faces.join("")}</style></defs>` : ""
  return cachedFontDefs
}
const DEFAULT_FONT_SIZE = 16
const DEFAULT_CELL_WIDTH = 9.6
const DEFAULT_CELL_HEIGHT = 20

const DEFAULT_THEME: Required<Pick<SvgTheme, "foreground" | "background" | "cursor">> = {
  foreground: "#d4d4d4",
  background: "#1e1e1e",
  cursor: "#aeafad",
}

// ── Color helpers ──

export function rgbToHex(color: RGB): string {
  const r = color.r.toString(16).padStart(2, "0")
  const g = color.g.toString(16).padStart(2, "0")
  const b = color.b.toString(16).padStart(2, "0")
  return `#${r}${g}${b}`
}

export function rgbToString(color: RGB | null, fallback: string): string {
  return color ? rgbToHex(color) : fallback
}

// ── Coordinate formatting ──

/**
 * Format a coordinate for SVG output: drop floating-point noise so cell
 * positions like `28.799999999999997` emit as `28.8`. Trailing zeros are
 * trimmed so integer coordinates stay integers.
 */
function coord(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

// ── XML escaping ──

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

// ── Span grouping for text rendering ──

interface TextSpan {
  text: string
  fill: string
  bold: boolean
  italic: boolean
  dim: boolean
  underline: boolean
  strikethrough: boolean
  startCol: number
  /**
   * Visual cell width this span occupies. NOT text.length — wide chars
   * (emoji, CJK) count 2 cells per char; narrow chars count 1. Used to
   * keep adjacent spans aligned on the cell grid and to advance startCol
   * for following spans.
   */
  cellCount: number
  /**
   * True if this span contains a single wide character (emoji / CJK).
   * Wide-char spans are NEVER merged with adjacent narrow-char spans, so
   * a multi-char span is always all-narrow — which lets spanToTspan emit
   * a clean per-character `x` list (one cellWidth step per glyph).
   */
  isWide: boolean
}

function cellFgBg(cell: Cell, themeFg: string, themeBg: string): { fg: string; bg: string } {
  let fg = rgbToString(cell.fg, themeFg)
  let bg = rgbToString(cell.bg, themeBg)
  if (cell.inverse) {
    ;[fg, bg] = [bg, fg]
  }
  return { fg, bg }
}

function spansMatch(
  a: TextSpan,
  fg: string,
  bold: boolean,
  italic: boolean,
  dim: boolean,
  underline: boolean,
  strikethrough: boolean,
): boolean {
  return (
    a.fill === fg &&
    a.bold === bold &&
    a.italic === italic &&
    a.dim === dim &&
    a.underline === underline &&
    a.strikethrough === strikethrough
  )
}

// ── Background rect merging ──

interface BgRect {
  x: number
  y: number
  width: number
  height: number
  fill: string
}

function buildBgRects(
  lines: Cell[][],
  cellWidth: number,
  cellHeight: number,
  themeFg: string,
  themeBg: string,
): BgRect[] {
  const rects: BgRect[] = []
  for (let row = 0; row < lines.length; row++) {
    const cells = lines[row]
    let runStart = -1
    let runColor = ""

    for (let col = 0; col < cells!.length; col++) {
      const cell = cells![col]!
      const { bg } = cellFgBg(cell, themeFg, themeBg)
      const hasCustomBg = bg !== themeBg

      if (hasCustomBg) {
        if (runStart >= 0 && runColor === bg) {
          // Continue the current run
        } else {
          // Flush previous run if any
          if (runStart >= 0) {
            rects.push({
              x: runStart * cellWidth,
              y: row * cellHeight,
              width: (col - runStart) * cellWidth,
              height: cellHeight,
              fill: runColor,
            })
          }
          runStart = col
          runColor = bg
        }
      } else {
        // No custom bg — flush any active run
        if (runStart >= 0) {
          rects.push({
            x: runStart * cellWidth,
            y: row * cellHeight,
            width: (col - runStart) * cellWidth,
            height: cellHeight,
            fill: runColor,
          })
          runStart = -1
          runColor = ""
        }
      }
    }

    // Flush trailing run
    if (runStart >= 0) {
      rects.push({
        x: runStart * cellWidth,
        y: row * cellHeight,
        width: (cells!.length - runStart) * cellWidth,
        height: cellHeight,
        fill: runColor,
      })
    }
  }
  return rects
}

// ── Text span building ──

function buildTextSpans(cells: Cell[], themeFg: string, themeBg: string): TextSpan[] {
  const spans: TextSpan[] = []

  for (let col = 0; col < cells.length; col++) {
    const cell = cells[col]!

    // Skip continuation cell of a wide character (the second cell).
    // A wide char's first cell has wide=true and non-empty text.
    // The second cell typically has empty text — skip it.
    if (cell.char === "" && col > 0 && cells[col - 1]?.wide) {
      continue
    }

    const { fg } = cellFgBg(cell, themeFg, themeBg)
    const char = cell.char || " "
    const underline = cell.underline !== false
    // Visual cells consumed by this cell: 2 for a wide-char head, 1 otherwise.
    // The continuation cell (col N+1 for wide at N) is `continue`d at the top
    // of the loop and never reaches here.
    const cellsForChar = cell.wide ? 2 : 1

    const current = spans.length > 0 ? spans[spans.length - 1] : null
    // Never merge a wide cell (emoji, CJK) with neighbors, even with same
    // styling. textLength+spacingAndGlyphs on a mixed tspan tries to
    // distribute N "characters" across cellCount × cellWidth pixels
    // uniformly — which squishes the emoji into a narrow slot, or stretches
    // surrounding letters off the cell grid. Isolating the wide char in
    // its own tspan lets the browser render the emoji at its natural width
    // and the surrounding text at cell-aligned positions.
    const canMerge =
      current &&
      !cell.wide &&
      !current.isWide &&
      spansMatch(current, fg, cell.bold, cell.italic, cell.dim, underline, cell.strikethrough)
    if (canMerge) {
      current!.text += char
      current!.cellCount += cellsForChar
    } else {
      spans.push({
        text: char,
        fill: fg,
        bold: cell.bold,
        italic: cell.italic,
        dim: cell.dim,
        underline,
        strikethrough: cell.strikethrough,
        startCol: col,
        cellCount: cellsForChar,
        isWide: cell.wide === true,
      })
    }
  }

  return spans
}

// ── Resolved options ──

interface ResolvedOptions {
  fontFamily: string
  fontSize: number
  cellWidth: number
  cellHeight: number
  themeFg: string
  themeBg: string
  themeCursor: string
  padding: number
  borderRadius: number
  windowBar: WindowBar
  windowBarSize: number
  windowTitle: string | null
  shadow: number
  margin: number
  marginFill: string | null
  embedFonts: boolean
}

function resolveOptions(options?: SvgScreenshotOptions): ResolvedOptions {
  return {
    fontFamily: options?.fontFamily ?? BUNDLED_FONT_FAMILY,
    fontSize: options?.fontSize ?? DEFAULT_FONT_SIZE,
    cellWidth: options?.cellWidth ?? DEFAULT_CELL_WIDTH,
    cellHeight: options?.cellHeight ?? DEFAULT_CELL_HEIGHT,
    themeFg: options?.theme?.foreground ?? DEFAULT_THEME.foreground,
    themeBg: options?.theme?.background ?? DEFAULT_THEME.background,
    themeCursor: options?.theme?.cursor ?? DEFAULT_THEME.cursor,
    padding: options?.padding ?? 0,
    borderRadius: options?.borderRadius ?? 0,
    windowBar: options?.windowBar ?? "none",
    windowBarSize: options?.windowBarSize ?? 40,
    windowTitle: options?.windowTitle ?? null,
    shadow: options?.shadow ?? 0,
    margin: options?.margin ?? 0,
    marginFill: options?.marginFill ?? null,
    embedFonts: options?.embedFonts ?? false,
  }
}

// ── Span → tspan conversion ──

function spanToTspan(span: TextSpan, cellWidth: number, themeFg: string): string {
  // Per-character cell-grid positioning. SVG `<tspan>` accepts `x` as a
  // *list* of coordinates — one per character — pinning each glyph to an
  // exact cell origin. This is renderer-agnostic: librsvg, @resvg/resvg-js,
  // and browsers all honour the per-glyph `x` list identically.
  //
  // The earlier approach used `textLength` + `lengthAdjust="spacingAndGlyphs"`
  // to stretch a whole span to `cellCount × cellWidth`. librsvg/browsers
  // render that cleanly, but @resvg/resvg-js distributes glyphs differently
  // — heavy, uneven letter-spacing, worst on bold faces (it picks a bold
  // face with different metrics, then spreads it). Since the GIF/PNG path
  // rasterizes via @resvg/resvg-js, that produced visibly broken output.
  // An explicit `x` list sidesteps stretch entirely: the renderer just
  // places each glyph at its cell origin and draws it at natural advance.
  //
  // Wide chars (emoji/CJK) are always isolated in their own single-char
  // span (see buildTextSpans), so a multi-char span is always all-narrow:
  // char `i` sits at `(startCol + i) × cellWidth`.
  const charCount = [...span.text].length
  let xValue: string
  if (charCount > 1) {
    const xs: string[] = []
    for (let i = 0; i < charCount; i++) xs.push(coord((span.startCol + i) * cellWidth))
    xValue = xs.join(" ")
  } else {
    xValue = coord(span.startCol * cellWidth)
  }
  const attrs: string[] = [`x="${xValue}"`]
  if (span.fill !== themeFg) attrs.push(`fill="${span.fill}"`)
  if (span.bold) attrs.push(`font-weight="bold"`)
  if (span.italic) attrs.push(`font-style="italic"`)
  if (span.dim) attrs.push(`opacity="0.5"`)

  const decorations: string[] = []
  if (span.underline) decorations.push("underline")
  if (span.strikethrough) decorations.push("line-through")
  if (decorations.length > 0) attrs.push(`text-decoration="${decorations.join(" ")}"`)

  return `<tspan ${attrs.join(" ")}>${escapeXml(span.text)}</tspan>`
}

// ── Text row rendering ──

/**
 * Resolve a wide-character span to a bundled Twemoji color SVG. Returns the
 * data URI when the codepoint sequence has a Twemoji asset and the optional
 * `@twemoji/svg` peer dependency is installed; null otherwise (in which case
 * the span falls back to font rendering via {@link spanToTspan}, which still
 * picks up the bundled monochrome Noto Emoji face).
 *
 * The text-span builder isolates every wide character in its own single-char
 * span (see {@link buildTextSpans}), so a multi-char emoji ZWJ sequence will
 * still arrive here as one span — there is no per-glyph splitting needed.
 */
function resolveEmojiSpan(span: TextSpan): string | null {
  if (!span.isWide) return null
  if (!isLikelyEmoji(span.text)) return null
  return loadTwemojiSvg(toTwemojiKey(span.text))
}

function renderTextRows(lines: Cell[][], opts: ResolvedOptions): string[] {
  const parts: string[] = []
  const { cellHeight, cellWidth, fontSize, fontFamily, themeFg, themeBg } = opts

  for (let row = 0; row < lines.length; row++) {
    const cells = lines[row]
    if (!cells || cells.length === 0) continue

    const spans = buildTextSpans(cells, themeFg, themeBg)
    if (spans.length === 0) continue

    // Baseline: top of cell + font size (approximate ascent for monospace)
    const y = row * cellHeight + fontSize
    // Partition spans: emoji spans (with a resolved Twemoji asset) become
    // sibling `<image>` elements; non-emoji spans collect into one `<text>`
    // per contiguous run with `<tspan>` children. A row may interleave
    // `<text>` and `<image>` siblings — both are positioned absolutely so
    // ordering matches the source row.
    let textOpen = false
    for (const span of spans) {
      const emojiUri = resolveEmojiSpan(span)
      if (emojiUri !== null) {
        if (textOpen) {
          parts.push(`</text>`)
          textOpen = false
        }
        // The emoji image spans 2 cells horizontally (wide char) and one
        // cell vertically. The Twemoji SVG viewBox is 36×36 — resvg honours
        // `<image>` width/height as the rendered box and scales the inner
        // SVG to fit. Positioning at the cell-grid origin keeps the emoji
        // aligned with surrounding monospace text.
        const x = coord(span.startCol * cellWidth)
        const yTop = coord(row * cellHeight)
        const w = coord(span.cellCount * cellWidth)
        const h = coord(cellHeight)
        parts.push(`<image x="${x}" y="${yTop}" width="${w}" height="${h}" href="${emojiUri}"/>`)
        continue
      }
      if (!textOpen) {
        parts.push(
          `<text x="0" y="${y}" font-family="${escapeXml(fontFamily)}" font-size="${fontSize}" fill="${themeFg}">`,
        )
        textOpen = true
      }
      parts.push(spanToTspan(span, cellWidth, themeFg))
    }
    if (textOpen) parts.push(`</text>`)
  }

  return parts
}

// ── Cursor rendering ──

function renderCursor(cursor: CursorState, opts: ResolvedOptions): string | null {
  if (!cursor.visible) return null

  const cx = cursor.x * opts.cellWidth
  const cy = cursor.y * opts.cellHeight

  // Default to block if backend doesn't report cursor style
  const style = cursor.style ?? "block"

  switch (style) {
    case "block":
      return `<rect x="${cx}" y="${cy}" width="${opts.cellWidth}" height="${opts.cellHeight}" fill="${opts.themeCursor}" opacity="0.5"/>`
    case "underline":
      return `<rect x="${cx}" y="${cy + opts.cellHeight - 2}" width="${opts.cellWidth}" height="2" fill="${opts.themeCursor}"/>`
    case "beam":
      return `<rect x="${cx}" y="${cy}" width="2" height="${opts.cellHeight}" fill="${opts.themeCursor}"/>`
  }
}

// ── Window bar rendering ──

/**
 * Parse a `#rrggbb` hex string into an RGB triple. Returns null for any
 * non-hex input (named colors, `transparent`, etc.) so callers can fall back.
 */
function parseHex(color: string): RGB | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(color.trim())
  if (!m) return null
  const n = parseInt(m[1]!, 16)
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
}

/** Relative luminance (0..1) of an RGB color, per the sRGB perceptual weights. */
function luminance(c: RGB): number {
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255
}

/**
 * Derive a window-bar background that sits naturally against the terminal
 * background: a touch lighter on dark themes, a touch darker on light themes.
 * Falls back to the classic macOS-grey `#333333` when the theme bg is not a
 * parseable hex color.
 */
function deriveBarColor(themeBg: string): string {
  const rgb = parseHex(themeBg)
  if (!rgb) return "#333333"
  const dark = luminance(rgb) < 0.5
  const shift = dark ? 28 : -28
  const clamp = (v: number) => Math.max(0, Math.min(255, v + shift))
  return rgbToHex({ r: clamp(rgb.r), g: clamp(rgb.g), b: clamp(rgb.b) })
}

/** Title text color that contrasts a given bar background. */
function titleColorFor(barColor: string): string {
  const rgb = parseHex(barColor)
  if (!rgb) return "#cccccc"
  return luminance(rgb) < 0.5 ? "#cccccc" : "#333333"
}

function renderWindowBar(
  barWidth: number,
  barHeight: number,
  style: WindowBar,
  borderRadius: number,
  themeBg: string,
  title: string | null,
): string[] {
  if (style === "none") return []

  const parts: string[] = []
  const barColor = deriveBarColor(themeBg)

  // Window bar background — use only top border radius
  parts.push(
    `<rect width="${barWidth}" height="${barHeight}" rx="${borderRadius}" ry="${borderRadius}" fill="${barColor}"/>`,
  )
  // Cover the bottom corners so only top has border radius
  if (borderRadius > 0) {
    parts.push(
      `<rect y="${barHeight - borderRadius}" width="${barWidth}" height="${borderRadius}" fill="${barColor}"/>`,
    )
  }

  const titleColor = titleColorFor(barColor)

  if (style === "windows") {
    // Flat Windows-style title bar — minimize / maximize / close glyphs at the
    // right edge. The glyphs are drawn as line art so they render identically
    // in every rasterizer (no glyph-font dependency).
    const slot = 46 // px per control slot
    const glyphSize = 10
    const cy = barHeight / 2
    const closeX = barWidth - slot / 2
    const maxX = barWidth - slot * 1.5
    const minX = barWidth - slot * 2.5
    const half = glyphSize / 2
    // Minimize — a horizontal bar.
    parts.push(
      `<line x1="${minX - half}" y1="${cy}" x2="${minX + half}" y2="${cy}" stroke="${titleColor}" stroke-width="1.4"/>`,
    )
    // Maximize — a hollow square.
    parts.push(
      `<rect x="${maxX - half}" y="${cy - half}" width="${glyphSize}" height="${glyphSize}" fill="none" stroke="${titleColor}" stroke-width="1.4"/>`,
    )
    // Close — an X, drawn on a red hover-style ground for visual weight.
    parts.push(
      `<line x1="${closeX - half}" y1="${cy - half}" x2="${closeX + half}" y2="${cy + half}" stroke="#e81123" stroke-width="1.6"/>`,
    )
    parts.push(
      `<line x1="${closeX - half}" y1="${cy + half}" x2="${closeX + half}" y2="${cy - half}" stroke="#e81123" stroke-width="1.6"/>`,
    )
    // Title text — left-aligned, the Windows convention.
    if (title) {
      parts.push(
        `<text x="14" y="${cy}" font-size="13" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" fill="${titleColor}" dominant-baseline="central">${escapeXml(title)}</text>`,
      )
    }
    return parts
  }

  // macOS traffic-light dots
  const dotRadius = 6
  const dotY = barHeight / 2
  const dotStartX = 20

  if (style === "rings") {
    // Outlined circles (like inactive/unfocused window)
    parts.push(
      `<circle cx="${dotStartX}" cy="${dotY}" r="${dotRadius}" fill="none" stroke="#ff5f57" stroke-width="1.5"/>`,
    )
    parts.push(
      `<circle cx="${dotStartX + 20}" cy="${dotY}" r="${dotRadius}" fill="none" stroke="#febc2e" stroke-width="1.5"/>`,
    )
    parts.push(
      `<circle cx="${dotStartX + 40}" cy="${dotY}" r="${dotRadius}" fill="none" stroke="#28c840" stroke-width="1.5"/>`,
    )
  } else {
    // Filled circles (colorful — like active/focused window)
    parts.push(`<circle cx="${dotStartX}" cy="${dotY}" r="${dotRadius}" fill="#ff5f57"/>`)
    parts.push(`<circle cx="${dotStartX + 20}" cy="${dotY}" r="${dotRadius}" fill="#febc2e"/>`)
    parts.push(`<circle cx="${dotStartX + 40}" cy="${dotY}" r="${dotRadius}" fill="#28c840"/>`)
  }

  // macOS title — flush-left to the right of the traffic-light dots,
  // matching the live recording overlay's bold-flush-left layout.
  // Dots sit at x=20, 40, 60 (radius 6) → rightmost edge ≈ 66; pad to 80.
  if (title) {
    const titleStartX = dotStartX + 40 + dotRadius + 14 // 80
    parts.push(
      `<text x="${titleStartX}" y="${dotY}" font-size="13" font-family="'Helvetica Neue', Arial, sans-serif" font-weight="bold" fill="${titleColor}" dominant-baseline="central">${escapeXml(title)}</text>`,
    )
  }

  return parts
}

// ── Main renderer ──

export function screenshotSvg(terminal: TerminalReadable, options?: SvgScreenshotOptions): string {
  const opts = resolveOptions(options)
  const {
    cellWidth,
    cellHeight,
    themeFg,
    themeBg,
    padding,
    borderRadius,
    windowBar,
    windowBarSize,
    windowTitle,
    shadow,
    margin,
    marginFill,
  } = opts

  const lines = terminal.getLines()
  const rows = lines.length
  const cols = rows > 0 ? Math.max(...lines.map((l) => l.length)) : 0

  // Terminal content dimensions
  const contentWidth = cols * cellWidth
  const contentHeight = rows * cellHeight

  // Detect whether any visual chrome is active
  const hasChrome = padding > 0 || borderRadius > 0 || windowBar !== "none" || margin > 0 || shadow > 0

  // Fast path: no chrome — produce the classic minimal SVG (backward-compatible)
  if (!hasChrome) {
    const totalWidth = contentWidth
    const totalHeight = contentHeight
    const parts: string[] = []

    // viewBox lets rasterizers (rsvg-convert, Chromium, qlmanage) scale the
    // SVG to a target raster size while preserving aspect. Without it, some
    // rasterizers fall back to fixed-size canvases (qlmanage always produces
    // 1680x1680 thumbnails) and the SVG content shrinks-to-fit, distorting
    // dHash/pixel comparisons that expect a known output geometry.
    // preserveAspectRatio="xMidYMid meet" is the standard SVG default — we
    // emit it explicitly so consumers can override via the SVG element if
    // they want a different fit strategy.
    parts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" preserveAspectRatio="xMidYMid meet">`,
    )
    if (opts.embedFonts) parts.push(embeddedFontFaceDefs())
    parts.push(`<rect width="100%" height="100%" fill="${themeBg}"/>`)

    for (const rect of buildBgRects(lines, cellWidth, cellHeight, themeFg, themeBg)) {
      parts.push(
        `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="${rect.fill}"/>`,
      )
    }

    parts.push(...renderTextRows(lines, opts))

    const cursorSvg = renderCursor(terminal.getCursor(), opts)
    if (cursorSvg) parts.push(cursorSvg)

    parts.push(`</svg>`)
    return parts.join("\n")
  }

  // Chrome path: padding, border radius, window bar, margin
  const barHeight = windowBar !== "none" ? windowBarSize : 0
  const innerWidth = contentWidth + padding * 2
  const innerHeight = contentHeight + padding * 2 + barHeight
  const totalWidth = innerWidth + margin * 2
  const totalHeight = innerHeight + margin * 2

  const parts: string[] = []

  // viewBox + preserveAspectRatio mirror the fast-path emission so chrome-mode
  // SVGs scale predictably under rasterizers that ignore intrinsic dimensions.
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" preserveAspectRatio="xMidYMid meet">`,
  )
  if (opts.embedFonts) parts.push(embeddedFontFaceDefs())

  // Defs: a soft drop-shadow filter + (optionally) the border-radius clip path.
  // The shadow is a gaussian-blurred dark copy of the alpha channel, offset
  // slightly downward — the standard "floating window" look that Freeze / VHS
  // produce. It is rendered renderer-agnostically (resvg + browsers both
  // honour feDropShadow), so it survives the GIF/PNG rasterization path.
  const hasDefs = shadow > 0 || borderRadius > 0
  if (hasDefs) parts.push(`<defs>`)
  if (shadow > 0) {
    parts.push(
      `<filter id="window-shadow" x="-50%" y="-50%" width="200%" height="200%">` +
        `<feDropShadow dx="0" dy="${coord(shadow * 0.35)}" stdDeviation="${coord(shadow)}" flood-color="#000000" flood-opacity="0.45"/>` +
        `</filter>`,
    )
  }
  if (borderRadius > 0) {
    parts.push(
      `<clipPath id="terminal-clip">` +
        `<rect x="${margin}" y="${margin}" width="${innerWidth}" height="${innerHeight}" rx="${borderRadius}" ry="${borderRadius}"/>` +
        `</clipPath>`,
    )
  }
  if (hasDefs) parts.push(`</defs>`)

  // Outer margin fill
  if (margin > 0 && marginFill) {
    parts.push(`<rect width="100%" height="100%" fill="${marginFill}"/>`)
  }

  // Drop shadow — a rounded rect matching the window outline, blurred via the
  // filter above. Drawn before (under) the window itself.
  if (shadow > 0) {
    const shAttrs =
      borderRadius > 0
        ? `x="${margin}" y="${margin}" width="${innerWidth}" height="${innerHeight}" rx="${borderRadius}" ry="${borderRadius}"`
        : `x="${margin}" y="${margin}" width="${innerWidth}" height="${innerHeight}"`
    parts.push(`<rect ${shAttrs} fill="${themeBg}" filter="url(#window-shadow)"/>`)
  }

  if (borderRadius > 0) {
    parts.push(`<g clip-path="url(#terminal-clip)">`)
  }

  // Terminal background rect
  const bgAttrs =
    borderRadius > 0
      ? `x="${margin}" y="${margin}" width="${innerWidth}" height="${innerHeight}" rx="${borderRadius}" ry="${borderRadius}"`
      : `x="${margin}" y="${margin}" width="${innerWidth}" height="${innerHeight}"`
  parts.push(`<rect ${bgAttrs} fill="${themeBg}"/>`)

  // Window bar
  if (windowBar !== "none") {
    parts.push(`<g transform="translate(${margin}, ${margin})">`)
    parts.push(...renderWindowBar(innerWidth, barHeight, windowBar, borderRadius, themeBg, windowTitle))
    parts.push(`</g>`)
  }

  // Content group — offset by margin + padding + window bar
  const contentOffsetX = margin + padding
  const contentOffsetY = margin + padding + barHeight
  parts.push(`<g transform="translate(${contentOffsetX}, ${contentOffsetY})">`)

  for (const rect of buildBgRects(lines, cellWidth, cellHeight, themeFg, themeBg)) {
    parts.push(`<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="${rect.fill}"/>`)
  }

  parts.push(...renderTextRows(lines, opts))

  const cursorSvg = renderCursor(terminal.getCursor(), opts)
  if (cursorSvg) parts.push(cursorSvg)

  parts.push(`</g>`)

  if (borderRadius > 0) {
    parts.push(`</g>`)
  }

  parts.push(`</svg>`)
  return parts.join("\n")
}
