/**
 * SVG screenshot renderer for termless.
 *
 * Converts a terminal cell grid (TerminalReadable) into an SVG string.
 * Pure function with no side effects — suitable for snapshots, docs, and debugging.
 */

import type { TerminalReadable, SvgScreenshotOptions, SvgTheme, Cell, RGB, CursorState } from "./types.ts"

// ── Defaults ──

const DEFAULT_FONT_FAMILY = "'Menlo', 'Monaco', 'Courier New', monospace"
const DEFAULT_FONT_SIZE = 14
const DEFAULT_CELL_WIDTH = 8.4
const DEFAULT_CELL_HEIGHT = 18

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

    const current = spans.length > 0 ? spans[spans.length - 1] : null
    if (current && spansMatch(current, fg, cell.bold, cell.italic, cell.dim, underline, cell.strikethrough)) {
      current.text += char
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
}

function resolveOptions(options?: SvgScreenshotOptions): ResolvedOptions {
  return {
    fontFamily: options?.fontFamily ?? DEFAULT_FONT_FAMILY,
    fontSize: options?.fontSize ?? DEFAULT_FONT_SIZE,
    cellWidth: options?.cellWidth ?? DEFAULT_CELL_WIDTH,
    cellHeight: options?.cellHeight ?? DEFAULT_CELL_HEIGHT,
    themeFg: options?.theme?.foreground ?? DEFAULT_THEME.foreground,
    themeBg: options?.theme?.background ?? DEFAULT_THEME.background,
    themeCursor: options?.theme?.cursor ?? DEFAULT_THEME.cursor,
  }
}

// ── Span → tspan conversion ──

function spanToTspan(span: TextSpan, cellWidth: number, themeFg: string): string {
  const attrs: string[] = [`x="${span.startCol * cellWidth}"`]
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
    parts.push(`<text x="0" y="${y}" font-family="${escapeXml(fontFamily)}" font-size="${fontSize}" fill="${themeFg}">`)

    for (const span of spans) {
      parts.push(spanToTspan(span, cellWidth, themeFg))
    }

    parts.push(`</text>`)
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

// ── Main renderer ──

export function screenshotSvg(terminal: TerminalReadable, options?: SvgScreenshotOptions): string {
  const opts = resolveOptions(options)
  const { cellWidth, cellHeight, themeFg, themeBg } = opts

  const lines = terminal.getLines()
  const rows = lines.length
  const cols = rows > 0 ? Math.max(...lines.map((l) => l.length)) : 0
  const totalWidth = cols * cellWidth
  const totalHeight = rows * cellHeight

  const parts: string[] = []

  // SVG header + full background
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}">`)
  parts.push(`<rect width="100%" height="100%" fill="${themeBg}"/>`)

  // Background rects for cells with non-default bg (merged adjacent)
  for (const rect of buildBgRects(lines, cellWidth, cellHeight, themeFg, themeBg)) {
    parts.push(`<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="${rect.fill}"/>`)
  }

  // Text rows
  parts.push(...renderTextRows(lines, opts))

  // Cursor overlay
  const cursorSvg = renderCursor(terminal.getCursor(), opts)
  if (cursorSvg) parts.push(cursorSvg)

  parts.push(`</svg>`)
  return parts.join("\n")
}
