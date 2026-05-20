/**
 * Native canvas rendering engine for @termless/ghostty — Visual Eyes without
 * the browser.
 *
 * Drives ghostty-web's CanvasRenderer with `@napi-rs/canvas` (Skia, native)
 * as the backing canvas. No headless Chromium, no Playwright dependency, no
 * `node:http` server, no SVG round-trip. The renderer sees real Ghostty cell
 * metrics and paints real glyphs; we encode the resulting Skia surface to PNG
 * in-process.
 *
 * Replaces the legacy `screenshotCanvasPng()` from `vendor/termless/src/canvas-render.ts`.
 * The legacy export stays callable until the wider migration is complete —
 * this file is the new path. Callsite migration happens in a later phase.
 *
 * Two public entry points:
 *
 *   - {@link renderAnsiPng} — raw bytes path. Preferred when ANSI is already
 *     on hand (e.g. a recorded PTY snapshot, an MCP-tool capture, the canonical
 *     test fixture). Skips the cells-roundtrip; ghostty-web parses the bytes
 *     directly with the same VT engine real Ghostty uses.
 *
 *   - {@link renderTerminalPng} — terminal snapshot path. Wraps
 *     {@link cellsToAnsi} + {@link renderAnsiPng}. Useful when the source state
 *     lives in an existing TerminalReadable (xterm.js, vterm, etc.) and you
 *     want a visual of that state through Ghostty's renderer.
 *
 * DOM shims are applied lazily on the first call (module-scoped, idempotent)
 * so importing this file is side-effect free for other tests.
 *
 * @see https://github.com/Brooooooklyn/canvas — @napi-rs/canvas (Skia bindings)
 * @see https://github.com/mitchellh/ghostty — Ghostty (renderer source)
 */

import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { createCanvas, GlobalFonts, type Canvas } from "@napi-rs/canvas"
import type { TerminalReadable } from "../../../src/types.ts"
import { cellsToAnsi } from "./cells-to-ansi.ts"

// ── Types ──

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
   * Font family as a CSS string. If `fontPath` is given, the bundled font is
   * registered under "TermlessCanvasFont" and prepended to this list. Default
   * "monospace".
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

// ── DOM shim (lazy, idempotent) ──

let domShimApplied = false

/**
 * Apply just-enough browser globals so ghostty-web's CanvasRenderer thinks it
 * has a DOM. Idempotent — safe to call repeatedly. Module-scoped, applied
 * lazily on the first render so importing this file is side-effect-free.
 *
 * What ghostty-web's CanvasRenderer actually touches (verified empirically
 * in `tmp-spike/native-canvas-render.ts`):
 *   - `canvas.style.{width,height} = "Npx"` — settable, never read.
 *   - `canvas.width / canvas.height` — already on Canvas, no shim needed.
 *   - `document.createElement("canvas")` — inside `measureFont`; gets a 1×1
 *     throwaway and immediately calls `getContext`.
 *   - `window.devicePixelRatio` — read for default DPR resolution.
 *
 * Other DOM features (addEventListener, getBoundingClientRect, parentNode,
 * etc.) live in Terminal/SelectionManager which we don't instantiate — they
 * never touch CanvasRenderer alone.
 */
function ensureDomShim(dpr: number): void {
  if (domShimApplied) {
    // Update DPR if needed — last writer wins. ghostty-web reads this lazily.
    const w = (globalThis as unknown as { window?: { devicePixelRatio?: number } }).window
    if (w) w.devicePixelRatio = dpr
    ;(globalThis as unknown as { devicePixelRatio?: number }).devicePixelRatio = dpr
    return
  }

  // 1. canvas.style proxy — writes only, never reads.
  const protoSample = createCanvas(1, 1)
  const napiCanvasProto = Object.getPrototypeOf(protoSample) as object
  if (!("style" in napiCanvasProto)) {
    Object.defineProperty(napiCanvasProto, "style", {
      configurable: true,
      get(this: { __style?: Record<string, string> }) {
        if (!this.__style) this.__style = {}
        return this.__style
      },
    })
  }

  // 2. document.createElement('canvas') — used inside ghostty-web's measureFont.
  const g = globalThis as unknown as {
    document?: { createElement: (tag: string) => unknown }
    window?: { devicePixelRatio?: number }
    devicePixelRatio?: number
  }
  if (!g.document) {
    g.document = {
      createElement(tag: string) {
        if (tag === "canvas") {
          // (1,1) NOT (0,0) — @napi-rs/canvas rejects 0×0.
          return createCanvas(1, 1)
        }
        throw new Error(`document.createElement: unsupported tag '${tag}' (termless DOM shim)`)
      },
    }
  }

  // 3. window.devicePixelRatio.
  if (!g.window) {
    g.window = { devicePixelRatio: dpr }
  } else {
    g.window.devicePixelRatio = dpr
  }
  if (g.devicePixelRatio == null) g.devicePixelRatio = dpr

  domShimApplied = true
}

// ── ghostty-web ESM loader ──

interface GhosttyWebModule {
  Ghostty: {
    load: (wasmPath?: string) => Promise<{
      createTerminal: (cols: number, rows: number) => GhosttyTerminalHandle
    }>
  }
  CanvasRenderer: new (canvas: unknown, opts: unknown) => GhosttyCanvasRenderer
}

interface GhosttyTerminalHandle {
  write: (data: string | Uint8Array) => void
  update: () => void
}

interface GhosttyCanvasRenderer {
  remeasureFont(): void
  resize(cols: number, rows: number): void
  setCursorBlink(b: boolean): void
  setCursorVisible?: (v: boolean) => void
  render(buf: unknown, forceAll?: boolean): void
  metrics: { width: number; height: number; baseline: number }
  charWidth: number
  charHeight: number
}

let ghosttyModuleCache: { mod: GhosttyWebModule; wasmPath: string } | null = null

async function loadGhosttyWeb(): Promise<{ mod: GhosttyWebModule; wasmPath: string }> {
  if (ghosttyModuleCache) return ghosttyModuleCache
  try {
    const req = createRequire(import.meta.url)
    // Resolve via the wasm subpath (always exported) and walk up to package root.
    const wasmPath = req.resolve("ghostty-web/ghostty-vt.wasm")
    const pkgRoot = wasmPath.slice(0, wasmPath.length - "/ghostty-vt.wasm".length)
    const pkgJsonPath = `${pkgRoot}/package.json`
    const pkgJson = JSON.parse((await readFile(pkgJsonPath)).toString())
    const esmRel: string = pkgJson.exports?.["."]?.import ?? pkgJson.module ?? pkgJson.main
    if (!esmRel) throw new Error("ghostty-web: no ESM export entry resolvable from package.json")
    const jsPath = `${pkgRoot}/${esmRel.replace(/^\.\//, "")}`
    const mod = (await import(jsPath)) as GhosttyWebModule
    ghosttyModuleCache = { mod, wasmPath }
    return ghosttyModuleCache
  } catch (cause) {
    throw new Error(
      "renderAnsiPng() requires the ghostty-web package. Install it:\n  bun add ghostty-web",
      { cause },
    )
  }
}

/**
 * Load the ghostty-web WASM in a way that works under both Bun and Node
 * (vitest's default pool). ghostty-web's `Ghostty.load(path)` calls a
 * try-chain of Bun.file → vite-browser-external readFile (no-op shim under
 * node) → fetch(path). On Node, the first two fail and fetch can't handle a
 * raw filesystem path ("Failed to parse URL"); even a `file://` URL trips
 * node's fetch implementation. Pre-reading the bytes via fs and stubbing
 * globalThis.fetch for the duration of load() keeps the engine's contract
 * (works regardless of runtime) without forking ghostty-web.
 *
 * Bun gets the fast path: `Ghostty.load(wasmPath)` hits Bun.file directly.
 */
async function loadGhosttyInstance(
  mod: GhosttyWebModule,
  wasmPath: string,
): Promise<Awaited<ReturnType<GhosttyWebModule["Ghostty"]["load"]>>> {
  const hasBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined"
  if (hasBun) {
    return mod.Ghostty.load(wasmPath)
  }
  // Node path: pre-read bytes, stub fetch for the wasmPath, call load.
  const bytes = await readFile(wasmPath)
  const originalFetch = (globalThis as { fetch?: typeof fetch }).fetch
  ;(globalThis as { fetch?: typeof fetch }).fetch = (async (input: unknown) => {
    if (input === wasmPath) {
      return new Response(
        new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer]),
        { status: 200 },
      )
    }
    if (!originalFetch) throw new Error("global fetch not available")
    return originalFetch(input as RequestInfo)
  }) as typeof fetch
  try {
    return await mod.Ghostty.load(wasmPath)
  } finally {
    ;(globalThis as { fetch?: typeof fetch }).fetch = originalFetch
  }
}

// ── Font registration ──

const registeredFontPaths = new Set<string>()
const BUNDLED_FONT_NAME = "TermlessCanvasFont"

function registerFontIfNeeded(fontPath: string): void {
  if (registeredFontPaths.has(fontPath)) return
  if (!existsSync(fontPath)) {
    throw new Error(`renderAnsiPng(): fontPath does not exist: ${fontPath}`)
  }
  GlobalFonts.registerFromPath(fontPath, BUNDLED_FONT_NAME)
  registeredFontPaths.add(fontPath)
}

// ── Cursor style mapping ──

function mapCursorStyle(s: RenderOptions["cursorStyle"]): "block" | "underline" | "bar" {
  if (s === "beam") return "bar"
  return s ?? "block"
}

// ── Resample (Skia in-process) ──

function resampleCanvas(src: Canvas, targetWidth: number, targetHeight: number): Canvas {
  if (src.width === targetWidth && src.height === targetHeight) return src
  const resized = createCanvas(targetWidth, targetHeight)
  const ctx = resized.getContext("2d")
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  // Type quirk: @napi-rs/canvas's drawImage accepts a Canvas but its DOM-style
  // signature requires CanvasImageSource. Cast through unknown.
  ctx.drawImage(src as unknown as never, 0, 0, targetWidth, targetHeight)
  return resized
}

// ── Public API ──

const DECAWM_OFF_PREAMBLE = "\x1b[H\x1b[2J\x1b[?7l\x1b[?25l"

function toUtf8String(bytes: string | Uint8Array): string {
  if (typeof bytes === "string") return bytes
  return new TextDecoder().decode(bytes)
}

/**
 * Render raw ANSI bytes to a PNG via ghostty-web's CanvasRenderer + native
 * Skia canvas. This is the preferred entry point when the ANSI source is
 * already on hand — bypasses the cells round-trip entirely.
 *
 * Prepends a deterministic preamble (`\x1b[H \x1b[2J \x1b[?7l \x1b[?25l`)
 * unless the input already starts with it. The preamble is what stops
 * ghostty-web from dropping the top N rows when every row fills the right
 * margin (DECAWM pending-wrap behavior).
 *
 * @example
 * ```ts
 * const png = await renderAnsiPng("\x1b[31mhello\x1b[0m", {
 *   cols: 80, rows: 24,
 *   fontPath: "/Users/me/Library/Fonts/FiraMonoNerdFontMono-Bold.otf",
 * })
 * await Bun.write("./out.png", png)
 * ```
 */
export async function renderAnsiPng(
  ansi: string | Uint8Array,
  opts: RenderOptions & { returnMeta: true },
): Promise<{ png: Uint8Array; meta: RenderMeta }>
export async function renderAnsiPng(ansi: string | Uint8Array, opts?: RenderOptions): Promise<Uint8Array>
export async function renderAnsiPng(
  ansi: string | Uint8Array,
  opts: RenderOptions = {},
): Promise<Uint8Array | { png: Uint8Array; meta: RenderMeta }> {
  const cols = opts.cols ?? 100
  const rows = opts.rows ?? 40
  const fontSize = opts.fontSize ?? 16
  const dpr = opts.dpr ?? 2
  const theme: Required<CanvasTheme> = { ...DEFAULT_THEME, ...(opts.theme ?? {}) }
  const cursorStyle = mapCursorStyle(opts.cursorStyle)
  const cursorBlink = opts.cursorBlink ?? false

  // 1. DOM shim (idempotent).
  ensureDomShim(dpr)

  // 2. Font registration (idempotent).
  let fontFamily = opts.fontFamily ?? "monospace"
  if (opts.fontPath) {
    registerFontIfNeeded(opts.fontPath)
    fontFamily = `${BUNDLED_FONT_NAME}, ${fontFamily}`
  }

  // 3. Load ghostty-web ESM bundle + WASM.
  const { mod, wasmPath } = await loadGhosttyWeb()
  const ghostty = await loadGhosttyInstance(mod, wasmPath)

  // 4. Create the WASM terminal.
  const terminal = ghostty.createTerminal(cols, rows)

  // 5. Create the target canvas. CanvasRenderer.resize() will overwrite the
  //    dimensions, but @napi-rs/canvas requires a positive initial size. Pick
  //    a generous default that matches the eventual ratio so we don't pay for
  //    an unused buffer.
  const initialW = Math.max(1, cols * Math.ceil(fontSize * 0.6) * dpr)
  const initialH = Math.max(1, rows * Math.ceil(fontSize * 1.25) * dpr)
  let canvas = createCanvas(initialW, initialH) as Canvas

  // 6. Instantiate CanvasRenderer with our shim'd canvas.
  const renderer = new mod.CanvasRenderer(canvas, {
    fontSize,
    fontFamily,
    cursorStyle,
    cursorBlink,
    devicePixelRatio: dpr,
    theme,
  })

  // 7. Measure + resize. The metrics override (cellWidth / cellHeight) lands
  //    AFTER remeasureFont and BEFORE resize, mirroring the legacy path.
  renderer.remeasureFont()
  if (opts.cellWidth != null) renderer.metrics.width = opts.cellWidth
  if (opts.cellHeight != null) {
    renderer.metrics.height = opts.cellHeight
    renderer.metrics.baseline = Math.min(renderer.metrics.baseline, opts.cellHeight - 1)
  }
  renderer.resize(cols, rows)
  renderer.setCursorBlink(cursorBlink)
  if (opts.hideCursor && typeof renderer.setCursorVisible === "function") {
    renderer.setCursorVisible(false)
  }

  // 8. Feed bytes. Prepend the DECAWM-off preamble unless the caller already
  //    included it (idempotent — the preamble is purely state-setting).
  const ansiStr = toUtf8String(ansi)
  const bytes = ansiStr.startsWith(DECAWM_OFF_PREAMBLE) ? ansiStr : DECAWM_OFF_PREAMBLE + ansiStr
  terminal.write(bytes)
  terminal.update()

  // 9. Paint.
  renderer.render(terminal, true)

  // 10. Optional in-process resample.
  if (opts.targetWidth != null && opts.targetHeight != null) {
    canvas = resampleCanvas(canvas, opts.targetWidth, opts.targetHeight)
  }

  // 11. Encode PNG via the async encoder (off the main loop).
  const png = await canvas.encode("png")
  const out = png instanceof Uint8Array ? png : new Uint8Array(png)

  if (opts.returnMeta) {
    const meta: RenderMeta = {
      width: canvas.width,
      height: canvas.height,
      cols,
      rows,
      cellWidth: renderer.metrics.width,
      cellHeight: renderer.metrics.height,
      dpr,
    }
    return { png: out, meta }
  }
  return out
}

/**
 * Render an in-memory TerminalReadable to a PNG via ghostty-web. Wraps
 * {@link cellsToAnsi} + {@link renderAnsiPng}.
 *
 * Useful when the source state lives in a terminal backed by a different
 * VT parser (xterm.js, vterm, libvterm, etc.) and you want a visual that
 * goes through Ghostty's renderer. The trade-off is a cells round-trip:
 * parser disagreements between the source backend and ghostty-web get
 * baked into the cells before they reach the renderer.
 *
 * For maximum fidelity, capture the raw bytes you fed to the source
 * terminal and pass them to {@link renderAnsiPng} directly.
 */
export async function renderTerminalPng(
  terminal: TerminalReadable,
  opts: RenderOptions & { returnMeta: true },
): Promise<{ png: Uint8Array; meta: RenderMeta }>
export async function renderTerminalPng(
  terminal: TerminalReadable,
  opts?: RenderOptions,
): Promise<Uint8Array>
export async function renderTerminalPng(
  terminal: TerminalReadable,
  opts: RenderOptions = {},
): Promise<Uint8Array | { png: Uint8Array; meta: RenderMeta }> {
  const cols = opts.cols ?? inferCols(terminal) ?? 100
  const rows = opts.rows ?? inferRows(terminal) ?? 40
  const ansi = cellsToAnsi(terminal, { cols, rows })
  if (opts.returnMeta) {
    return renderAnsiPng(ansi, { ...opts, cols, rows, returnMeta: true })
  }
  return renderAnsiPng(ansi, { ...opts, cols, rows })
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

// ── Internal exports for testing ──

/** @internal — reset the DOM-shim sentinel so tests can verify the lazy path. */
export function _resetDomShimForTesting(): void {
  domShimApplied = false
}
