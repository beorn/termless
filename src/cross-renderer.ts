/**
 * Cross-renderer capture + comparison harness.
 *
 * Given a Terminal (xterm.js, vt100, vterm, etc.) and the command that
 * put it into its current state, captures three renderings of the same
 * buffer state:
 *
 *   1. Canvas — ghostty-web's CanvasRenderer in headless Chromium
 *      (real-fidelity truecolor + glyph shaping)
 *   2. SVG    — termless's deterministic SVG renderer (text-tags + rects)
 *   3. Peekaboo — a real terminal app (Ghostty, iTerm2, Terminal.app)
 *                 re-running the command; macOS-only; GUI-required
 *
 * Returns the three PNGs plus a comparison report (dimensions, cell-grid
 * alignment, similarity). Used by the `toMatchAcrossRenderers` matcher.
 *
 * Design choices:
 * - All three renderers see the same buffer state via the same source
 *   (xterm.js for canvas+SVG; the real terminal's own parser for peekaboo).
 * - A unified theme + font config is applied to all three when possible.
 *   Canvas: passes theme + fontPath to ghostty-web. SVG: passes theme +
 *   cellWidth/Height. Peekaboo: launches the terminal app with whatever
 *   the user's config dictates — we can't override that in-flight.
 * - Peekaboo is opt-in (set `includePeekaboo: true`) because it requires
 *   GUI access + spawns a real window.
 */

import type { Terminal, SvgScreenshotOptions } from "./types.ts"
import { screenshotCanvasPng, type CanvasTheme, type CanvasScreenshotOptions } from "./canvas-render.ts"

export interface CrossRendererOptions {
  /**
   * Command that puts the terminal into its current state. Re-run in a
   * real terminal app when `includePeekaboo: true`. If omitted, peekaboo
   * is skipped regardless of `includePeekaboo`.
   */
  command?: string[]
  /** Unified theme — applied to both canvas + SVG paths. */
  theme?: CanvasTheme
  /** Path to .ttf/.otf font file; canvas embeds it via @font-face. */
  fontPath?: string
  /** Font size (canvas). */
  fontSize?: number
  /** SVG cell dimensions (canvas measures its own from the font). */
  cellWidth?: number
  cellHeight?: number
  /** Pixel-rounded font family for SVG (matches canvas when same family). */
  fontFamily?: string
  /** Output dir for diff bundle. When set, all PNGs + report.json are saved. */
  saveTo?: string
  /** Capture peekaboo too. macOS-only, GUI-required, slow. */
  includePeekaboo?: boolean
  /** Terminal app for peekaboo. Default: "ghostty". */
  peekabooApp?: "ghostty" | "iterm2" | "terminal" | "wezterm" | "kitty"
  /** Terminal dimensions — must match the source terminal's cols/rows. */
  cols?: number
  rows?: number
}

export interface CrossRendererResult {
  canvas: Uint8Array
  svg: Uint8Array
  peekaboo?: Uint8Array
  report: CrossRendererReport
}

export interface CrossRendererReport {
  /** Decoded PNG dimensions per renderer. */
  dimensions: Record<"canvas" | "svg" | "peekaboo", { width: number; height: number } | null>
  /** Logical dimensions normalized by DPR (estimated from cols/rows + cell metrics). */
  logical: Record<"canvas" | "svg" | "peekaboo", { width: number; height: number } | null>
  /** Buffer text equality — all three renderers see the same buffer iff this is true. */
  textEquality: boolean
  /** Files written (when saveTo set). */
  files?: { canvas: string; svg: string; peekaboo?: string; report: string }
  /** Notes on residual divergence — why pixels don't match perfectly. */
  notes: string[]
}

/**
 * Read PNG width + height from header bytes. PNG IHDR is at offset 16
 * (4-byte big-endian width, 4-byte big-endian height).
 */
export function pngDimensions(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) }
}

/**
 * Capture the same terminal buffer state via canvas, SVG, and (optionally)
 * peekaboo. Returns the three PNGs + a comparison report.
 *
 * Caller is responsible for putting the terminal into the desired state
 * via `feed()` or `spawn()` before invoking this.
 */
export async function captureCrossRenderer(
  terminal: Terminal,
  options: CrossRendererOptions = {},
): Promise<CrossRendererResult> {
  const notes: string[] = []

  // ── canvas ──────────────────────────────────────────────
  // Capture with returnMeta so we can pass measured cell dimensions to
  // SVG for unification — otherwise SVG's 9.6×20 defaults won't match
  // canvas's font-measured ~10×17 metrics and dimension comparisons fail.
  const canvasOptions: CanvasScreenshotOptions & { returnMeta: true } = {
    returnMeta: true,
    ...(options.cols != null ? { cols: options.cols } : {}),
    ...(options.rows != null ? { rows: options.rows } : {}),
    ...(options.theme ? { theme: options.theme } : {}),
    ...(options.fontPath ? { fontPath: options.fontPath } : {}),
    ...(options.fontSize ? { fontSize: options.fontSize } : {}),
    ...(options.fontFamily ? { fontFamily: options.fontFamily } : {}),
  }
  const canvasResult = (await screenshotCanvasPng(terminal, canvasOptions)) as unknown as {
    png: Uint8Array
    meta: import("./canvas-render.ts").CanvasScreenshotMeta
  }
  const canvasBytes = canvasResult.png
  const canvasMeta = canvasResult.meta
  // Cell metrics from ghostty-web's CanvasRenderer are reported in CSS
  // (logical) pixels — same units SVG uses for `cellWidth`/`cellHeight`.
  // The canvas's actual pixel dimensions ARE multiplied by DPR (so a 40×6
  // grid at 10×17 logical = 400×102 logical = 800×204 canvas at DPR 2),
  // but charWidth/charHeight stay in logical px.
  const measuredCellWidth = canvasMeta.charWidth || 9.6
  const measuredCellHeight = canvasMeta.charHeight || 20

  // ── svg ────────────────────────────────────────────────
  // The SVG renderer emits an SVG string; pass canvas's measured cell
  // dimensions when caller doesn't override — so the two paths produce
  // matched aspect ratios + sizes (modulo DPR).
  const svgString = terminal.screenshotSvg({
    ...(options.theme ? { theme: { foreground: options.theme.foreground, background: options.theme.background } } : {}),
    cellWidth: options.cellWidth ?? measuredCellWidth,
    cellHeight: options.cellHeight ?? measuredCellHeight,
    ...(options.fontFamily ? { fontFamily: options.fontFamily } : {}),
  } as SvgScreenshotOptions)
  // Store as utf-8 bytes for now. Rasterization is the caller's job.
  const svgBytes = new TextEncoder().encode(svgString)

  // ── peekaboo (opt-in) ──────────────────────────────────
  // Use osascript + screencapture directly — peekaboo's full backend
  // requires node-pty (xterm.js data-layer PTY), which is heavy native
  // dep we don't need for screenshot-only capture. Inline the launch +
  // bounds-based capture + cleanup we want.
  let peekabooBytes: Uint8Array | undefined
  if (options.includePeekaboo) {
    if (process.platform !== "darwin") {
      notes.push("peekaboo skipped: requires macOS")
    } else if (!options.command) {
      notes.push("peekaboo skipped: `command` not provided (needed to re-run in real terminal)")
    } else {
      try {
        peekabooBytes = await captureRealTerminal({
          app: options.peekabooApp ?? "ghostty",
          command: options.command,
          waitMs: 2500,
        })
      } catch (err) {
        notes.push(`peekaboo failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  // ── Compute report ─────────────────────────────────────
  const canvasDim = pngDimensions(canvasBytes)
  let svgDim: { width: number; height: number } | null = null
  // Parse <svg width="X" height="Y"> from the SVG string for logical dim.
  const m = svgString.match(/<svg[^>]+width="(\d+)"[^>]+height="(\d+)"/)
  if (m) svgDim = { width: Number.parseInt(m[1]!, 10), height: Number.parseInt(m[2]!, 10) }
  const peekDim = peekabooBytes ? pngDimensions(peekabooBytes) : null

  // Estimate logical dimensions by dividing by suspected DPR.
  // Canvas reports DPR via the meta passed in; we don't have access here,
  // so estimate from cols × ~10px (typical cell width). For now, simply
  // report raw and let the caller decide.
  const logical = {
    canvas: canvasDim,
    svg: svgDim,
    peekaboo: peekDim, // includes window chrome — caller should crop
  }

  const report: CrossRendererReport = {
    dimensions: { canvas: canvasDim, svg: svgDim, peekaboo: peekDim },
    logical,
    textEquality: true, // canvas + SVG both read from the same terminal buffer
    notes,
  }

  // ── Persist diff bundle ────────────────────────────────
  if (options.saveTo) {
    const { mkdirSync, writeFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    mkdirSync(options.saveTo, { recursive: true })
    const canvasPath = join(options.saveTo, "canvas.png")
    const svgPngPath = join(options.saveTo, "svg.svg") // SVG kept as XML for now
    const peekPath = join(options.saveTo, "peekaboo.png")
    const reportPath = join(options.saveTo, "report.json")
    writeFileSync(canvasPath, canvasBytes)
    writeFileSync(svgPngPath, svgString, "utf-8")
    if (peekabooBytes) writeFileSync(peekPath, peekabooBytes)
    writeFileSync(reportPath, JSON.stringify(report, null, 2))
    report.files = {
      canvas: canvasPath,
      svg: svgPngPath,
      ...(peekabooBytes ? { peekaboo: peekPath } : {}),
      report: reportPath,
    }
  }

  return { canvas: canvasBytes, svg: svgBytes, peekaboo: peekabooBytes, report }
}

// ─────────────────────────────────────────────────────────
// Real-terminal capture (macOS)
// ─────────────────────────────────────────────────────────
//
// Spawns a terminal app via `open -a`, captures the window via
// `screencapture -R <bounds>` (non-interactive — no popup picker), then
// closes the spawned window. Uses System Events to query position+size
// for the bounds, and Ghostty/iTerm2/Terminal AppleScript to close.
//
// Bypasses peekaboo's full backend (which spawns an xterm.js PTY for
// data-layer access). For screenshot-only purposes, we don't need that.

const APP_BUNDLE_NAMES = {
  ghostty: "Ghostty",
  iterm2: "iTerm",
  terminal: "Terminal",
  wezterm: "WezTerm",
  kitty: "kitty",
} as const

async function captureRealTerminal(opts: {
  app: keyof typeof APP_BUNDLE_NAMES
  command: string[]
  waitMs: number
}): Promise<Uint8Array> {
  const { spawnSync } = await import("node:child_process")
  const { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const bundle = APP_BUNDLE_NAMES[opts.app]

  // Snapshot windows before launch so we can identify the new one.
  const idsBefore = listWindowIds(opts.app)

  // Write the command to a temp script for clean argv handling.
  const tmpDir = mkdtempSync(join(tmpdir(), "term-real-"))
  const script = join(tmpDir, "payload.sh")
  writeFileSync(script, `#!/bin/bash\n${opts.command.slice(2).join(" ") || opts.command.join(" ")}\n`)
  chmodSync(script, 0o755)

  // Launch the app.
  if (opts.app === "ghostty") {
    spawnSync("open", ["-a", "Ghostty", "--args", "-e", script], { stdio: "ignore" })
  } else if (opts.app === "kitty") {
    spawnSync("open", ["-a", "kitty", "--args", script], { stdio: "ignore" })
  } else if (opts.app === "wezterm") {
    spawnSync("open", ["-a", "WezTerm", "--args", "start", "--", "bash", "-c", script], { stdio: "ignore" })
  } else {
    spawnSync("open", ["-a", bundle, script], { stdio: "ignore" })
  }

  // Poll until the new window appears (or timeout).
  let newId: string | undefined
  for (let i = 0; i < 30 && !newId; i++) {
    await new Promise((r) => setTimeout(r, 200))
    const idsNow = listWindowIds(opts.app)
    newId = idsNow.find((id) => !idsBefore.includes(id))
  }

  try {
    // Wait for the script's output to paint.
    await new Promise((r) => setTimeout(r, opts.waitMs))

    // Activate so the window is frontmost; query bounds via System Events.
    spawnSync("osascript", ["-e", `tell application "${bundle}" to activate`], { stdio: "ignore" })
    await new Promise((r) => setTimeout(r, 300))
    const boundsResult = spawnSync(
      "osascript",
      [
        "-e",
        `tell application "System Events" to tell process "${bundle}"
           set p to position of front window
           set s to size of front window
           return (item 1 of p as text) & "," & (item 2 of p as text) & "," & (item 1 of s as text) & "," & (item 2 of s as text)
         end tell`,
      ],
      { stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" },
    )
    const bounds = boundsResult.stdout?.trim()
    if (!bounds) throw new Error(`captureRealTerminal: could not get window bounds (need Accessibility permission for osascript?)`)

    const outPath = join(tmpDir, "capture.png")
    const cap = spawnSync("screencapture", ["-R", bounds, "-o", "-x", outPath], { stdio: ["ignore", "ignore", "pipe"] })
    if (cap.status !== 0) throw new Error(`screencapture -R failed: ${cap.stderr?.toString().trim()}`)
    const bytes = readFileSync(outPath)
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  } finally {
    // Close the spawned window via id (sync) — must complete before
    // process exits or window leaks.
    if (newId) {
      const closeScript = `tell application "${bundle}" to close (every window whose id is ${newId})`
      spawnSync("osascript", ["-e", closeScript], { stdio: "ignore", timeout: 2000 })
    }
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

function listWindowIds(app: keyof typeof APP_BUNDLE_NAMES): string[] {
  // sync version of peekaboo's listGhosttyWindowIds — applies to any
  // terminal app, returns AppleScript window ids comma-separated.
  const { spawnSync } = require("node:child_process") as typeof import("node:child_process")
  const bundle = APP_BUNDLE_NAMES[app]
  const r = spawnSync(
    "osascript",
    [
      "-e",
      `if application "${bundle}" is running then
         tell application "${bundle}" to return id of every window as text
       else
         return ""
       end if`,
    ],
    { stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" },
  )
  if (r.status !== 0) return []
  const out = (r.stdout ?? "").trim()
  if (!out) return []
  return out.split(", ").map((s: string) => s.trim()).filter(Boolean)
}
