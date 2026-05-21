/**
 * Visual Eyes Phase 7 — cross-backend canvas compare.
 *
 * The "one renderer, N parsers" design (Phase 3): the same `.tape` is replayed
 * through each backend's *own* VT parser, then every resulting terminal state
 * is rendered through the **same** canvas pipeline (`renderTerminalPng` —
 * ghostty-web's CanvasRenderer + native Skia). Because the renderer is held
 * constant, any pixel difference between two panels is attributable to a
 * **parser divergence** — not a rendering-engine difference.
 *
 * This is what catches real parser bugs: OSC8 hyperlink handling, wide-char
 * width disagreements, DEC private mode interpretation, kitty-graphics, etc.
 *
 * Contrast with {@link compareTape} (`./compare.ts`), which screenshots each
 * backend through *its own* SVG renderer — that mixes parser + renderer
 * differences and can't isolate one from the other.
 *
 * Three compare modes:
 *
 *   - **side-by-side** — N panels in a labeled row, one per backend.
 *   - **diff**         — the N panels PLUS an extra "divergence" panel where
 *                        any pixel that differs between *any* pair of backends
 *                        is painted red.
 *   - **separate**     — no composition; the per-backend PNGs are returned raw.
 *
 * Animation: when `animate: true`, every Screenshot command in the tape (or a
 * synthetic final frame) becomes a GIF frame; the per-backend GIF streams are
 * time-synced (same frame count, same per-frame delay) so they can be played
 * side by side.
 */

import type { TapeFile } from "./parser.ts"
import type { Cell, CursorState, Terminal, TerminalBackend, TerminalReadable } from "../../terminal/types.ts"
import { executeTape, type TapeExecutorOptions } from "./executor.ts"
import { renderTerminalPng, type CanvasTheme, type RenderOptions } from "@termless/ghostty"
import { pngDimensions } from "../../compare.ts"
import { encodePng, decodePngRgba, type RgbaImage } from "./png-codec.ts"

// =============================================================================
// Types
// =============================================================================

export type CanvasCompareMode = "separate" | "side-by-side" | "diff"

/** A backend specification: a name string, or a pre-created instance + label. */
export type CanvasBackendSpec = string | { name: string; backend: TerminalBackend }

export interface CanvasCompareOptions {
  /** Backend names or instances to compare. At least one; ≥2 for `diff`. */
  backends: CanvasBackendSpec[]
  /** Compare mode. Default `side-by-side`. */
  mode?: CanvasCompareMode
  /** Canvas render options forwarded to `renderTerminalPng` (theme, font, dpr). */
  render?: Pick<RenderOptions, "fontSize" | "fontFamily" | "fontPath" | "dpr"> & { theme?: CanvasTheme }
  /** Terminal columns override. */
  cols?: number
  /** Terminal rows override. */
  rows?: number
  /** Executor options forwarded to each backend run. */
  executorOptions?: Omit<TapeExecutorOptions, "backend">
  /**
   * Collect a frame per Screenshot command (plus a final frame) so the caller
   * can stitch a time-synced GIF. Default false (single final frame only).
   */
  animate?: boolean
  /** Panel caption height in px. Default 28. */
  captionHeight?: number
  /** Gap between panels in px. Default 12. */
  gap?: number
}

/** One backend's render of one tape frame. */
export interface CanvasBackendFrame {
  /** PNG bytes from `renderTerminalPng`. */
  png: Uint8Array
  /** Decoded RGBA (lazy-filled by the compositor). */
  rgba?: RgbaImage
}

/** A backend's full result: label, text, and the per-frame canvas renders. */
export interface CanvasBackendResult {
  backend: string
  /** Final terminal text — used for the text-equality check. */
  text: string
  /** One entry per captured frame (≥1; last entry is the final state). */
  frames: CanvasBackendFrame[]
}

export interface CanvasCompareResult {
  /** Per-backend results, in input order. */
  backends: CanvasBackendResult[]
  /** Composed PNG (side-by-side / diff modes); undefined for `separate`. */
  composedPng?: Uint8Array
  /** Composed PNG per frame when `animate` is set — index-aligned across time. */
  composedFrames?: Uint8Array[]
  /** True iff every backend produced byte-identical final text. */
  textMatch: boolean
  /** Diff mode only: count of pixels that differ between any backend pair. */
  divergentPixels?: number
  /** Total pixels considered for the divergence overlay. */
  totalPixels?: number
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Replay a tape through N backends and render every result through the same
 * canvas pipeline. See the file header for the design rationale.
 */
export async function compareCanvas(tape: TapeFile, options: CanvasCompareOptions): Promise<CanvasCompareResult> {
  if (options.backends.length === 0) {
    throw new Error("compareCanvas: at least one backend is required")
  }
  const mode = options.mode ?? "side-by-side"
  const captionHeight = options.captionHeight ?? 28
  const gap = options.gap ?? 12

  const results: CanvasBackendResult[] = []

  // ── Run the tape through each backend, render every frame via the canvas ──
  for (const spec of options.backends) {
    const backendOpt = typeof spec === "string" ? spec : spec.backend
    const backendLabel = typeof spec === "string" ? spec : spec.name

    // Frames are captured as terminal *snapshots* — a deep copy of the cell
    // grid + cursor. We render each snapshot through the canvas after the run
    // so the renderer config is identical across every backend and frame.
    // Capturing the real Cell[][] (not just text) preserves colour, wide
    // chars, and hyperlinks — so parser divergence in any of those surfaces.
    const snapshots: TerminalSnapshot[] = []
    const capture = (term: Terminal) => {
      snapshots.push(snapshotTerminal(term))
    }

    const run = await executeTape(tape, {
      ...options.executorOptions,
      backend: backendOpt,
      ...(options.cols != null ? { cols: options.cols } : {}),
      ...(options.rows != null ? { rows: options.rows } : {}),
      onScreenshot: options.animate
        ? (_png, _path) => {
            // The screenshot callback fires inside executeTape; the terminal
            // is captured via onAfterCommand below to get the post-command
            // state. Here we just mark intent — see onAfterCommand.
          }
        : undefined,
      onAfterCommand: options.animate
        ? (cmd, term) => {
            if (cmd.type === "screenshot") capture(term)
          }
        : undefined,
    })

    // Always capture the final state as the last frame.
    capture(run.terminal)

    const renderOpts: RenderOptions = {
      cols: run.terminal.cols,
      rows: run.terminal.rows,
      ...(options.render?.fontSize != null ? { fontSize: options.render.fontSize } : {}),
      ...(options.render?.fontFamily != null ? { fontFamily: options.render.fontFamily } : {}),
      ...(options.render?.fontPath != null ? { fontPath: options.render.fontPath } : {}),
      ...(options.render?.dpr != null ? { dpr: options.render.dpr } : {}),
      ...(options.render?.theme ? { theme: options.render.theme } : {}),
    }

    const frames: CanvasBackendFrame[] = []
    for (const snap of snapshots) {
      const png = await renderTerminalPng(snapshotReadable(snap), renderOpts)
      frames.push({ png })
    }

    const text = run.terminal.getText()
    results.push({ backend: backendLabel, text, frames })
    await run.terminal.close()
  }

  const textMatch = results.every((r) => r.text === results[0]!.text)

  // ── separate: no composition ─────────────────────────────
  if (mode === "separate") {
    return { backends: results, textMatch }
  }

  // ── Compose ──────────────────────────────────────────────
  // Time-sync: every backend gets `frameCount` frames. Backends with fewer
  // frames repeat their last frame (a tape may screenshot at different
  // points, but the canonical use is identical tapes → identical counts).
  const frameCount = options.animate ? Math.max(...results.map((r) => r.frames.length)) : 1

  const composedFrames: Uint8Array[] = []
  let lastDivergent = 0
  let lastTotal = 0

  for (let f = 0; f < frameCount; f++) {
    const panelImages = results.map((r) => {
      const idx = options.animate ? Math.min(f, r.frames.length - 1) : r.frames.length - 1
      return { label: r.backend, png: r.frames[idx]!.png }
    })

    if (mode === "diff") {
      const composed = composeDiff(panelImages, { captionHeight, gap })
      composedFrames.push(composed.png)
      lastDivergent = composed.divergentPixels
      lastTotal = composed.totalPixels
    } else {
      composedFrames.push(composeSideBySide(panelImages, { captionHeight, gap }))
    }
  }

  return {
    backends: results,
    composedPng: composedFrames[composedFrames.length - 1],
    ...(options.animate ? { composedFrames } : {}),
    textMatch,
    ...(mode === "diff" ? { divergentPixels: lastDivergent, totalPixels: lastTotal } : {}),
  }
}

// =============================================================================
// Terminal snapshot → TerminalReadable adapter
// =============================================================================

/** A frozen copy of a terminal's visible cell grid + cursor. */
interface TerminalSnapshot {
  grid: Cell[][]
  cursor: CursorState
  cols: number
  rows: number
  title: string
}

const BLANK_CELL: Cell = {
  char: " ",
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  underlineColor: null,
  strikethrough: false,
  inverse: false,
  blink: false,
  hidden: false,
  wide: false,
  continuation: false,
  hyperlink: null,
}

/** Deep-copy a terminal's current visible state. */
function snapshotTerminal(term: Terminal): TerminalSnapshot {
  const grid = term.getLines().map((row) => row.map((cell) => ({ ...cell })))
  let cursor: CursorState
  try {
    cursor = term.getCursor()
  } catch {
    cursor = { x: 0, y: 0, visible: false, style: null }
  }
  let title = ""
  try {
    title = term.getTitle()
  } catch {
    // ignore — title is optional
  }
  return { grid, cursor, cols: term.cols, rows: term.rows, title }
}

/**
 * Wrap a {@link TerminalSnapshot} as a `TerminalReadable` so
 * `renderTerminalPng` (→ `cellsToAnsi`) can paint it. The snapshot is a frozen
 * copy, so this view is stable even though the source terminal has closed.
 */
function snapshotReadable(snap: TerminalSnapshot): TerminalReadable {
  const cellAt = (row: number, col: number): Cell => snap.grid[row]?.[col] ?? BLANK_CELL
  return {
    getText: () => snap.grid.map((row) => row.map((c) => c.char || " ").join("")).join("\n"),
    getTextRange: (r1: number, c1: number, r2: number, c2: number) => {
      const out: string[] = []
      for (let r = r1; r <= r2; r++) {
        let line = ""
        for (let c = c1; c <= c2; c++) line += cellAt(r, c).char || " "
        out.push(line)
      }
      return out.join("\n")
    },
    getCell: cellAt,
    getLine: (row: number) => snap.grid[row] ?? [],
    getLines: () => snap.grid,
    getCursor: () => snap.cursor,
    getMode: () => false,
    getTitle: () => snap.title,
    getScrollback: () => ({ lines: [], total: 0 }),
    cols: snap.cols,
    rows: snap.rows,
  } as unknown as TerminalReadable
}

// =============================================================================
// Composition (PNG → PNG, no SVG round-trip)
// =============================================================================

interface PanelImage {
  label: string
  png: Uint8Array
}

interface ComposeLayout {
  captionHeight: number
  gap: number
}

/** Background colour of the composed canvas. */
const BG: [number, number, number, number] = [26, 27, 38, 255] // Tokyo Night bg
/** Caption text colour. */
const FG: [number, number, number, number] = [192, 202, 245, 255]
/** Divergence overlay colour. */
const DIVERGE: [number, number, number, number] = [255, 64, 64, 235]

/**
 * Compose N panels into one labelled row. Each panel is captioned with its
 * backend name. The result is a single PNG.
 */
export function composeSideBySide(panels: PanelImage[], layout: ComposeLayout): Uint8Array {
  const decoded = panels.map((p) => ({ label: p.label, img: decodePngRgba(p.png) }))
  const { captionHeight, gap } = layout

  const panelHeight = Math.max(...decoded.map((d) => d.img.height))
  const totalWidth = decoded.reduce((s, d) => s + d.img.width, 0) + (decoded.length - 1) * gap
  const totalHeight = panelHeight + captionHeight

  const canvas = blankImage(totalWidth, totalHeight)

  let x = 0
  for (const d of decoded) {
    drawCaption(canvas, d.label, x, d.img.width, captionHeight)
    blit(canvas, d.img, x, captionHeight)
    x += d.img.width + gap
  }
  return encodePng(canvas)
}

/**
 * Compose N panels PLUS a divergence panel. The divergence panel starts as the
 * first backend's render and overlays red on every pixel that differs between
 * any pair of backends.
 */
export function composeDiff(
  panels: PanelImage[],
  layout: ComposeLayout,
): { png: Uint8Array; divergentPixels: number; totalPixels: number } {
  if (panels.length < 2) {
    return { png: composeSideBySide(panels, layout), divergentPixels: 0, totalPixels: 0 }
  }
  const decoded = panels.map((p) => ({ label: p.label, img: decodePngRgba(p.png) }))
  const { captionHeight, gap } = layout

  // Divergence mask — over the common (min) area of all panels.
  const width = Math.min(...decoded.map((d) => d.img.width))
  const height = Math.min(...decoded.map((d) => d.img.height))
  const overlay = cloneRegion(decoded[0]!.img, width, height)
  let divergentPixels = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let divergent = false
      const base = decoded[0]!.img
      const bi = (y * base.width + x) * 4
      for (let p = 1; p < decoded.length && !divergent; p++) {
        const other = decoded[p]!.img
        const oi = (y * other.width + x) * 4
        if (
          base.data[bi] !== other.data[oi] ||
          base.data[bi + 1] !== other.data[oi + 1] ||
          base.data[bi + 2] !== other.data[oi + 2] ||
          base.data[bi + 3] !== other.data[oi + 3]
        ) {
          divergent = true
        }
      }
      if (divergent) {
        divergentPixels++
        const di = (y * width + x) * 4
        // Alpha-blend the red overlay over the base pixel.
        const a = DIVERGE[3] / 255
        overlay.data[di] = Math.round(DIVERGE[0] * a + overlay.data[di]! * (1 - a))
        overlay.data[di + 1] = Math.round(DIVERGE[1] * a + overlay.data[di + 1]! * (1 - a))
        overlay.data[di + 2] = Math.round(DIVERGE[2] * a + overlay.data[di + 2]! * (1 - a))
        overlay.data[di + 3] = 255
      }
    }
  }

  const allPanels: { label: string; img: RgbaImage }[] = [
    ...decoded,
    { label: `divergence (${divergentPixels} px)`, img: overlay },
  ]

  const panelHeight = Math.max(...allPanels.map((d) => d.img.height))
  const totalWidth = allPanels.reduce((s, d) => s + d.img.width, 0) + (allPanels.length - 1) * gap
  const totalHeight = panelHeight + captionHeight

  const canvas = blankImage(totalWidth, totalHeight)
  let cx = 0
  for (const d of allPanels) {
    drawCaption(canvas, d.label, cx, d.img.width, captionHeight)
    blit(canvas, d.img, cx, captionHeight)
    cx += d.img.width + gap
  }

  return { png: encodePng(canvas), divergentPixels, totalPixels: width * height }
}

// =============================================================================
// Raster helpers
// =============================================================================

function blankImage(width: number, height: number): RgbaImage {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = BG[0]
    data[i + 1] = BG[1]
    data[i + 2] = BG[2]
    data[i + 3] = BG[3]
  }
  return { width, height, data }
}

function cloneRegion(src: RgbaImage, width: number, height: number): RgbaImage {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const si = (y * src.width + x) * 4
      const di = (y * width + x) * 4
      data[di] = src.data[si]!
      data[di + 1] = src.data[si + 1]!
      data[di + 2] = src.data[si + 2]!
      data[di + 3] = src.data[si + 3]!
    }
  }
  return { width, height, data }
}

/** Copy `src` onto `dst` at (ox, oy). Source is clipped to the destination. */
function blit(dst: RgbaImage, src: RgbaImage, ox: number, oy: number): void {
  for (let y = 0; y < src.height; y++) {
    const dy = oy + y
    if (dy < 0 || dy >= dst.height) continue
    for (let x = 0; x < src.width; x++) {
      const dx = ox + x
      if (dx < 0 || dx >= dst.width) continue
      const si = (y * src.width + x) * 4
      const di = (dy * dst.width + dx) * 4
      dst.data[di] = src.data[si]!
      dst.data[di + 1] = src.data[si + 1]!
      dst.data[di + 2] = src.data[si + 2]!
      dst.data[di + 3] = src.data[si + 3]!
    }
  }
}

/**
 * Draw a backend caption — a 5×7 bitmap-font label, left-padded, vertically
 * centred in the caption band. Dependency-free so compose works without a
 * canvas/font stack.
 */
function drawCaption(dst: RgbaImage, label: string, ox: number, panelWidth: number, captionHeight: number): void {
  const scale = 2
  const glyphW = 6 * scale
  const glyphH = 7 * scale
  const text = label.slice(0, Math.max(0, Math.floor(panelWidth / glyphW)))
  const textWidth = text.length * glyphW
  const startX = ox + Math.max(2, Math.floor((panelWidth - textWidth) / 2))
  const startY = Math.max(0, Math.floor((captionHeight - glyphH) / 2))

  for (let i = 0; i < text.length; i++) {
    const glyph = FONT5x7[text[i]!.toUpperCase()] ?? FONT5x7["?"]!
    for (let row = 0; row < 7; row++) {
      const bits = glyph[row]!
      for (let col = 0; col < 5; col++) {
        if ((bits >> (4 - col)) & 1) {
          fillRect(dst, startX + (i * 6 + col) * scale, startY + row * scale, scale, scale, FG)
        }
      }
    }
  }
}

function fillRect(
  dst: RgbaImage,
  ox: number,
  oy: number,
  w: number,
  h: number,
  color: [number, number, number, number],
): void {
  for (let y = 0; y < h; y++) {
    const dy = oy + y
    if (dy < 0 || dy >= dst.height) continue
    for (let x = 0; x < w; x++) {
      const dx = ox + x
      if (dx < 0 || dx >= dst.width) continue
      const di = (dy * dst.width + dx) * 4
      dst.data[di] = color[0]
      dst.data[di + 1] = color[1]
      dst.data[di + 2] = color[2]
      dst.data[di + 3] = color[3]
    }
  }
}

/** Minimal 5×7 bitmap font — uppercase letters, digits, common punctuation. */
const FONT5x7: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
  "3": [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  "7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  "8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  "9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  " ": [0, 0, 0, 0, 0, 0, 0],
  "-": [0, 0, 0, 0x1f, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 0x0c, 0x0c],
  ",": [0, 0, 0, 0, 0, 0x0c, 0x08],
  "(": [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
  ")": [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
  ":": [0, 0x0c, 0x0c, 0, 0x0c, 0x0c, 0],
  "/": [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10],
  _: [0, 0, 0, 0, 0, 0, 0x1f],
  "?": [0x0e, 0x11, 0x01, 0x02, 0x04, 0, 0x04],
}

// Re-export for callers that need to verify panel geometry.
export { pngDimensions }
