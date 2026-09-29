/**
 * Theme colors fed to ghostty-web's CanvasRenderer. Fields default to the
 * Tokyo Night Storm palette (the spike validated against this). Override
 * individual fields; missing fields fall through to the default.
 */
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

export interface RenderOptions {
  /** Canvas columns. Default 100. */
  cols?: number
  /** Canvas rows. Default 40. */
  rows?: number
  /** Font size in CSS pixels. Default 16. */
  fontSize?: number
  /**
   * Font family as a CSS string, used as the primary face. If `fontPath` is
   * given, that font is registered and takes precedence over this. When
   * neither is supplied the renderer uses its bundled JetBrains Mono face —
   * NOT the platform `monospace` alias — so cell geometry is deterministic
   * across platforms. The bundled symbol + emoji fallback faces are always
   * appended after whatever primary face is in effect.
   */
  fontFamily?: string
  /**
   * Path to a .ttf/.otf file to register process-wide via
   * `GlobalFonts.registerFromPath`. Used as the first family. Re-registering
   * the same path is a no-op.
   */
  fontPath?: string
  /** Device pixel ratio. Default 2. */
  dpr?: number
  /** Theme colors. Defaults to Tokyo Night Storm. */
  theme?: CanvasTheme
  /** Cursor style. Default "block". Maps to ghostty-web 'bar' for "beam". */
  cursorStyle?: "block" | "underline" | "beam"
  /** Whether the cursor blinks (purely cosmetic for a single shot). */
  cursorBlink?: boolean
  /**
   * Hide the cursor entirely (prepends `\x1b[?25l` to the ANSI bytes). The
   * `cellsToAnsi` preamble already hides the cursor — this is for the raw
   * ANSI path. Default false (the preamble handles it).
   */
  hideCursor?: boolean
  /**
   * Override per-cell pixel metrics measured by ghostty-web. ghostty-web's
   * `measureFont` adds a constant 2-pixel padding row — generous compared
   * to real Ghostty's line-height-derived metric.
   *
   * Provide `cellWidth` / `cellHeight` (logical CSS pixels, pre-DPR) to pin
   * the canvas geometry exactly. Typical use: matching a reference screenshot
   * for visual-regression tests. If only one axis is given, the other is
   * left to the renderer's measurement.
   */
  cellWidth?: number
  cellHeight?: number
  /**
   * Final-size override applied after rasterization. The canvas is resampled
   * in-process via Skia's high-quality bilinear filter to exactly this
   * physical pixel size. Cross-platform (replaces the legacy macOS-only
   * `sips` shell-out).
   *
   * Provide both width and height in physical pixels. If either is missing
   * the resample is skipped.
   */
  targetWidth?: number
  targetHeight?: number
  /** Return PNG + metadata. Default false (just the PNG). */
  returnMeta?: boolean
}

export interface RenderMeta {
  /** Physical pixel width of the encoded PNG. */
  width: number
  /** Physical pixel height of the encoded PNG. */
  height: number
  cols: number
  rows: number
  /** Logical (CSS-pixel) cell width as measured by ghostty-web. */
  cellWidth: number
  /** Logical (CSS-pixel) cell height as measured by ghostty-web. */
  cellHeight: number
  dpr: number
}
