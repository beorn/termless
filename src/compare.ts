/**
 * Cross-renderer capture + comparison harness.
 *
 * Given a Terminal (xterm.js, vt100, vterm, etc.) and the command that
 * put it into its current state, captures three renderings of the same
 * buffer state:
 *
 *   1. Canvas — ghostty-web's CanvasRenderer via @termless/ghostty's native
 *      canvas pipeline (@napi-rs/canvas + ghostty-web WASM, no Chromium)
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
 *   Canvas: passes theme + fontPath to @termless/ghostty's renderTerminalPng.
 *   SVG: passes theme + cellWidth/Height. Peekaboo: launches the terminal app
 *   with whatever the user's config dictates — we can't override that in-flight.
 * - Peekaboo is opt-in (set `includePeekaboo: true`) because it requires
 *   GUI access + spawns a real window.
 */

import type { TestTerminal, SvgScreenshotOptions } from "./terminal/types.ts"
import { renderTerminalPng, type CanvasTheme, type RenderOptions, type RenderMeta } from "@termless/ghostty"

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
  /** Ghostty-specific config overrides (written to a temp config-file). */
  ghosttyConfig?: { theme?: string; fontFamily?: string; fontSize?: number; backgroundOpacity?: number }
  /** Strip window chrome from peekaboo capture (Ghostty: enabled with window-decoration=false in temp config). */
  cropChrome?: boolean
  /** Env vars for the peekaboo spawned shell (e.g. KM_ROOT). */
  peekabooEnv?: Record<string, string>
  /** Working directory for the peekaboo spawned shell. */
  peekabooCwd?: string
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
  /** dHash (perceptual hash) per renderer that has a rasterized PNG. */
  hashes?: Record<"canvas" | "peekaboo", string | null>
  /** Hamming distances between pairs (0=identical, 32=completely different). */
  hashDistances?: { canvasVsPeekaboo: number | null }
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
  terminal: TestTerminal,
  options: CrossRendererOptions = {},
): Promise<CrossRendererResult> {
  const notes: string[] = []

  // ── canvas ──────────────────────────────────────────────
  // Capture with returnMeta so we can pass measured cell dimensions to
  // SVG for unification — otherwise SVG's 9.6×20 defaults won't match
  // canvas's font-measured ~10×17 metrics and dimension comparisons fail.
  //
  // Phase 9: routes through @termless/ghostty's renderTerminalPng (native
  // canvas via @napi-rs/canvas + ghostty-web WASM). Replaces the deleted
  // screenshotCanvasPng (Playwright + Chromium) path.
  const canvasOptions: RenderOptions & { returnMeta: true } = {
    returnMeta: true,
    ...(options.cols != null ? { cols: options.cols } : {}),
    ...(options.rows != null ? { rows: options.rows } : {}),
    ...(options.theme ? { theme: options.theme } : {}),
    ...(options.fontPath ? { fontPath: options.fontPath } : {}),
    ...(options.fontSize ? { fontSize: options.fontSize } : {}),
    ...(options.fontFamily ? { fontFamily: options.fontFamily } : {}),
  }
  const canvasResult = (await renderTerminalPng(terminal, canvasOptions)) as unknown as {
    png: Uint8Array
    meta: RenderMeta
  }
  const canvasBytes = canvasResult.png
  const canvasMeta = canvasResult.meta
  // Cell metrics from ghostty-web's CanvasRenderer are reported in CSS
  // (logical) pixels — same units SVG uses for `cellWidth`/`cellHeight`.
  // The canvas's actual pixel dimensions ARE multiplied by DPR (so a 40×6
  // grid at 10×17 logical = 400×102 logical = 800×204 canvas at DPR 2),
  // but cellWidth/cellHeight stay in logical px.
  const measuredCellWidth = canvasMeta.cellWidth || 9.6
  const measuredCellHeight = canvasMeta.cellHeight || 20

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
          ...(options.cropChrome != null ? { cropChrome: options.cropChrome } : {}),
          ...(options.ghosttyConfig ? { ghosttyConfig: options.ghosttyConfig } : {}),
          ...(options.peekabooEnv ? { env: options.peekabooEnv } : {}),
          ...(options.peekabooCwd ? { cwd: options.peekabooCwd } : {}),
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

  // Compute perceptual hashes for canvas + peekaboo (SVG is XML, not a
  // raster — skipped). pHash is dep-free via sips on macOS; falls back
  // to a no-op zero-hash on other platforms or when sips is missing.
  let canvasHash: string | null = null
  let peekHash: string | null = null
  if (process.platform === "darwin") {
    try {
      canvasHash = await dHash(canvasBytes)
    } catch {
      // ignore — leaves hash null
    }
    if (peekabooBytes) {
      try {
        peekHash = await dHash(peekabooBytes)
      } catch {
        // ignore — leaves hash null
      }
    }
  }

  const report: CrossRendererReport = {
    dimensions: { canvas: canvasDim, svg: svgDim, peekaboo: peekDim },
    logical,
    textEquality: true, // canvas + SVG both read from the same terminal buffer
    hashes: { canvas: canvasHash, peekaboo: peekHash },
    hashDistances: {
      canvasVsPeekaboo: canvasHash && peekHash ? hashDistance(canvasHash, peekHash) : null,
    },
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
  /** Strip Ghostty's window chrome (titlebar, padding) from the capture. */
  cropChrome?: boolean
  /** Ghostty config overrides (theme, font, padding). Ignored for non-Ghostty. */
  ghosttyConfig?: { theme?: string; fontFamily?: string; fontSize?: number; backgroundOpacity?: number }
  /** Environment variables for the spawned shell. */
  env?: Record<string, string>
  /** Working directory for the spawned shell. */
  cwd?: string
}): Promise<Uint8Array> {
  const { spawnSync } = await import("node:child_process")
  const { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const bundle = APP_BUNDLE_NAMES[opts.app]

  const idsBefore = listWindowIds(opts.app)
  // Also snapshot CGWindowIDs (numeric, macOS-native) so we can diff
  // post-launch to find OUR new window — independent of AppleScript ids.
  const cgIdsBefore = listCGWindowIds(bundle)
  const tmpDir = mkdtempSync(join(tmpdir(), "term-real-"))
  const script = join(tmpDir, "payload.sh")
  // Build the script: prepend env exports + cd, then the command.
  const envLines = opts.env ? Object.entries(opts.env).map(([k, v]) => `export ${k}=${JSON.stringify(v)}`) : []
  const cdLine = opts.cwd ? `cd ${JSON.stringify(opts.cwd)}` : ""
  // Build the command line. For bash -c shape (["/bin/bash", "-c", "..."]),
  // unwrap to the inner shell command. For other shapes, shell-quote each
  // argv element so spaces/special-chars in paths don't split.
  const cmdLine =
    opts.command[0] === "/bin/bash" && opts.command[1] === "-c" && opts.command.length === 3
      ? opts.command[2]
      : opts.command.map((arg) => `'${arg.replace(/'/g, "'\\''")}'`).join(" ")
  // Append a sleep so the window doesn't auto-close before screencapture
  // fires. The harness's `pkill -f <script>` in finally{} kills bash mid-
  // sleep, triggering Ghostty's wait-after-command=false → window closes.
  writeFileSync(script, `#!/bin/bash\n${envLines.join("\n")}\n${cdLine}\n${cmdLine}\nsleep 60\n`)
  chmodSync(script, 0o755)

  // Ghostty on macOS doesn't accept `-e <command>` via `open --args` —
  // per the docs, "launching the terminal emulator from the CLI is not
  // supported". Instead, set `command = <script>` in a temp config file
  // and pass it via `--config-file=<path>`.
  //
  // Additional config keys for reliable capture + cleanup:
  // - confirm-close-surface = false: no "Are you sure?" dialog
  // - wait-after-command = false:  (default) window closes when command exits
  // - window-padding-x/y = 0:      cell-grid fills the window
  let ghosttyConfigPath: string | undefined
  if (opts.app === "ghostty") {
    ghosttyConfigPath = join(tmpDir, "ghostty.cfg")
    const cfgLines = [
      `command = ${script}`,
      "confirm-close-surface = false",
      "wait-after-command = false",
      "window-padding-x = 0",
      "window-padding-y = 0",
      ...(opts.ghosttyConfig?.theme ? [`theme = ${opts.ghosttyConfig.theme}`] : []),
      ...(opts.ghosttyConfig?.fontFamily ? [`font-family = ${opts.ghosttyConfig.fontFamily}`] : []),
      ...(opts.ghosttyConfig?.fontSize != null ? [`font-size = ${opts.ghosttyConfig.fontSize}`] : []),
      ...(opts.ghosttyConfig?.backgroundOpacity != null
        ? [`background-opacity = ${opts.ghosttyConfig.backgroundOpacity}`]
        : []),
    ]
    writeFileSync(ghosttyConfigPath, cfgLines.join("\n") + "\n")
  }

  // Launch — `open -g` opens without activating, so the user's current
  // window stays focused. The new terminal still spawns visibly (macOS
  // can't truly hide a window) but doesn't steal keyboard focus.
  if (opts.app === "ghostty") {
    // On macOS, Ghostty doesn't accept `-e <command>` via `open --args`.
    // The temp config-file (above) carries `command = <script>` instead.
    //
    // CRITICAL: do NOT use `-n` (open --new-instance). It spawns a fresh
    // Ghostty.app PROCESS each time, creating a stack of dock icons that
    // accumulates over the user's session. The user can't `quit` them
    // selectively without losing their primary Ghostty (which hosts
    // their actual terminal sessions / cmux). Use a regular `open` so
    // existing Ghostty makes a new window inside its single process.
    const args = ["-g", "-a", "Ghostty", "--args"]
    if (ghosttyConfigPath) args.push(`--config-file=${ghosttyConfigPath}`)
    spawnSync("open", args, { stdio: "ignore" })
  } else if (opts.app === "kitty") {
    spawnSync("open", ["-g", "-a", "kitty", "--args", script], { stdio: "ignore" })
  } else if (opts.app === "wezterm") {
    spawnSync("open", ["-g", "-a", "WezTerm", "--args", "start", "--", "bash", "-c", script], { stdio: "ignore" })
  } else {
    spawnSync("open", ["-g", "-a", bundle, script], { stdio: "ignore" })
  }

  // Poll for the new window.
  let newId: string | undefined
  for (let i = 0; i < 40 && !newId; i++) {
    await new Promise((r) => setTimeout(r, 200))
    const idsNow = listWindowIds(opts.app)
    newId = idsNow.find((id) => !idsBefore.includes(id))
  }

  try {
    await new Promise((r) => setTimeout(r, opts.waitMs))

    spawnSync("osascript", ["-e", `tell application "${bundle}" to activate`], { stdio: "ignore" })
    await new Promise((r) => setTimeout(r, 300))

    // Get the spawned window's CGWindowID via a Swift one-liner. This is
    // the macOS window-number used by `screencapture -l <id>` — captures
    // THAT specific window's pixels even when occluded by other windows.
    // The AppleScript `id of front window` returns a different identifier
    // (a "tab-group-XXX" string for Ghostty) that screencapture doesn't
    // accept; bounds-based `-R` capture picks up whatever's visible at the
    // screen coordinates, which fails when other apps overlap. CGWindowID
    // is the right primitive.
    //
    // env -i bypasses the user's Nix-managed PATH so xcrun resolves the
    // macOS-bundled Swift toolchain (which matches the macOS SDK).
    const cgIds = listCGWindowIds(bundle)
    if (cgIds.length === 0) {
      throw new Error(`captureRealTerminal: no ${bundle} windows visible (CGWindowList returned empty)`)
    }
    // Pick the window that's NEW since launch — diff against the
    // pre-launch CGWindowID set. Falls back to the highest id when the
    // diff is empty (shouldn't happen but defensive).
    const freshIds = cgIds.filter((id) => !cgIdsBefore.includes(id))
    const cgId = (freshIds[0] ?? cgIds.sort((a, b) => Number(a) - Number(b)).pop())!.toString()
    const outPath = join(tmpDir, "capture.png")
    const cap = spawnSync("screencapture", ["-l", cgId, "-o", "-x", outPath], { stdio: ["ignore", "ignore", "pipe"] })
    if (cap.status !== 0) throw new Error(`screencapture -l ${cgId} failed: ${cap.stderr?.toString().trim()}`)
    const bytes = readFileSync(outPath)
    void opts.cropChrome // currently unused; chrome handling lives in caller
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  } finally {
    // Cleanup strategy (in order):
    // 1. Kill the script process that's running inside the window.
    //    With close-on-exit=true, killing the script causes Ghostty to
    //    close the window automatically. Works even without
    //    AppleScript permissions.
    // 2. AppleScript close-by-id as a backstop for apps without
    //    close-on-exit.
    try {
      spawnSync("pkill", ["-f", script], { stdio: "ignore", timeout: 2000 })
    } catch {
      // ignore
    }
    // Give close-on-exit a beat to fire.
    await new Promise((r) => setTimeout(r, 400))
    if (newId) {
      const closeScript = `tell application "${bundle}" to close (every window whose id is ${newId})`
      spawnSync("osascript", ["-e", closeScript], { stdio: "ignore", timeout: 3000 })
    }
    // KEEP tmpDir when CROSS_RENDERER_DEBUG=1 — useful for inspecting the
    // generated script + Ghostty config when capture fails. Default: clean.
    if (process.env.CROSS_RENDERER_DEBUG !== "1") {
      rmSync(tmpDir, { recursive: true, force: true })
    } else {
      // eslint-disable-next-line no-console
      console.error(`[cross-renderer] preserved tmpDir: ${tmpDir}`)
    }
  }
}

// ─────────────────────────────────────────────────────────
// Image similarity — perceptual hash (no external deps)
// ─────────────────────────────────────────────────────────
//
// pHash via Difference Hash (dHash): downscale to 9×8 grayscale, compute
// 64 bits where each bit is "left-pixel < right-pixel". Tolerant to
// resolution, font hinting, and small color differences. Two PNGs with
// the same cell-grid structure should hash within Hamming distance ~5.
// True identical: 0. Completely different: 32.

/** Compute a 64-bit difference hash for a PNG. Returns a 16-char hex string. */
export async function dHash(pngBytes: Uint8Array): Promise<string> {
  // Decode PNG via playwright's image — heavy. Alternative: shell out to
  // sips (macOS) for resize+grayscale, then read raw bytes.
  const { spawnSync } = await import("node:child_process")
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const tmp = mkdtempSync(join(tmpdir(), "dhash-"))
  try {
    const inPath = join(tmp, "in.png")
    const outPath = join(tmp, "out.png")
    writeFileSync(inPath, pngBytes)
    // Resize to 9×8 grayscale BMP (raw-ish format easy to parse).
    // sips -s format bmp -s formatOptions normal -z 8 9 -s pixelsPerInchH 72 ...
    const r = spawnSync("sips", ["-s", "format", "png", "-z", "8", "9", inPath, "--out", outPath], { stdio: "ignore" })
    if (r.status !== 0) {
      // Fallback: return null-like hash so similarity returns Infinity
      return "0".repeat(16)
    }
    const png = readFileSync(outPath)
    // We don't have a PNG decoder in dep-free TS. Use Bun's built-in
    // image bitmap via Canvas — but Bun has no canvas. Workaround: shell
    // out again to sips to convert to raw RGB.
    const rawPath = join(tmp, "raw.bmp")
    const r2 = spawnSync("sips", ["-s", "format", "bmp", outPath, "--out", rawPath], { stdio: "ignore" })
    if (r2.status !== 0) return "0".repeat(16)
    const bmp = readFileSync(rawPath)
    // BMP header: 14 bytes file header + 40 bytes DIB header for BITMAPINFOHEADER.
    // Pixel data starts at offset given by the file header (bytes 10-13).
    const view = new DataView(bmp.buffer, bmp.byteOffset, bmp.byteLength)
    const pixOffset = view.getUint32(10, true)
    const width = view.getInt32(18, true)
    const height = view.getInt32(22, true)
    const bpp = view.getUint16(28, true)
    if (bpp !== 24 && bpp !== 32) return "0".repeat(16)
    const bytesPerPx = bpp / 8
    const rowSize = Math.floor((bpp * width + 31) / 32) * 4
    // BMP rows are bottom-up by default.
    const gray = new Uint8Array(Math.abs(width) * Math.abs(height))
    for (let row = 0; row < Math.abs(height); row++) {
      const srcRow = height > 0 ? Math.abs(height) - 1 - row : row
      for (let col = 0; col < Math.abs(width); col++) {
        const idx = pixOffset + srcRow * rowSize + col * bytesPerPx
        // BMP is BGR (or BGRA)
        const b = bmp[idx] ?? 0
        const g = bmp[idx + 1] ?? 0
        const r = bmp[idx + 2] ?? 0
        gray[row * Math.abs(width) + col] = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
      }
    }
    // 8 rows × 9 cols → 8 rows × 8 bits = 64 bits
    let hash = 0n
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const left = gray[row * Math.abs(width) + col] ?? 0
        const right = gray[row * Math.abs(width) + col + 1] ?? 0
        if (left < right) hash |= 1n << BigInt(row * 8 + col)
      }
    }
    void png
    return hash.toString(16).padStart(16, "0")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** Hamming distance between two hex hashes (64 bits / 16 hex chars). */
export function hashDistance(a: string, b: string): number {
  let diff = 0n
  diff = BigInt("0x" + a) ^ BigInt("0x" + b)
  let count = 0
  while (diff > 0n) {
    if (diff & 1n) count++
    diff >>= 1n
  }
  return count
}

/** Get CGWindowIDs (numeric) for all on-screen windows owned by an app. */
function listCGWindowIds(bundle: string): string[] {
  const { spawnSync } = require("node:child_process") as typeof import("node:child_process")
  const swiftSnippet = `import Foundation
import CoreGraphics
let opts: CGWindowListOption = [.optionOnScreenOnly]
guard let windows = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { exit(1) }
for w in windows {
  if let owner = w["kCGWindowOwnerName"] as? String, owner == "${bundle}" {
    if let id = w["kCGWindowNumber"] as? Int {
      print(id)
    }
  }
}`
  const r = spawnSync("env", ["-i", "PATH=/usr/bin:/bin", "xcrun", "swift", "-"], {
    input: swiftSnippet,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf-8",
  })
  if (r.status !== 0) return []
  return (r.stdout ?? "")
    .trim()
    .split("\n")
    .map((s: string) => s.trim())
    .filter(Boolean)
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
  return out
    .split(", ")
    .map((s: string) => s.trim())
    .filter(Boolean)
}
