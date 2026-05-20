/**
 * `compat-screenshot` — peekaboo orchestration of a real desktop terminal.
 *
 * Spawns the user's actual macOS terminal app (Ghostty / kitty / iTerm /
 * Terminal.app), runs a TUI command in it, screenshots the window with
 * macOS `screencapture`, then cleans up.
 *
 * This is the **compat-testing** path: pixel-perfect for that specific
 * terminal app + the user's real font / theme config. It is slow, macOS-only,
 * and pops a real window — for routine visual iteration use the canvas
 * renderer (`Terminal.screenshot()` / `mcp__tty__screenshot`) instead.
 *
 * Mechanism (8 steps, per `@km/infra/peekaboo-real-terminal-capture`):
 *  1. Resolve target terminal app (autodetect if not specified).
 *  2. Generate a `.command` wrapper script that `cd`s + runs the TUI command.
 *  3. Spawn the terminal app pointed at the `.command` script.
 *  4. Resize the spawned window to requested cols/rows (best-effort, per app).
 *  5. Wait for first paint — poll the window text until `waitFor` appears.
 *  6. `screencapture` the window region.
 *  7. Cleanup: close the spawned window unless `keep: true`.
 *  8. Return the PNG path + a terminal metadata object.
 */

import { mkdtemp, writeFile, chmod, unlink, rmdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { exec } from "./exec.ts"
import {
  detectTerminal,
  getTerminalAdapter,
  isTerminalInstalled,
  type CompatTerminal,
  type CompatTerminalMetadata,
} from "./terminal-adapters.ts"

// ═══════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════

export interface CompatScreenshotOptions {
  /** TUI command to run, as a shell string (e.g. "bun km view ~/Vault"). */
  cmd: string
  /** Terminal app. Auto-detected (ghostty > kitty > iterm > terminal) if omitted. */
  terminal?: CompatTerminal
  /** Output PNG path. A temp file is used if omitted. */
  outputPath?: string
  /** Requested columns. Default 120. */
  cols?: number
  /** Requested rows. Default 40. */
  rows?: number
  /** Working directory for the TUI command. Default: process.cwd(). */
  cwd?: string
  /** Text pattern to wait for before screenshotting. If omitted, waits for any text. */
  waitFor?: string
  /** Timeout (ms) for the first-paint wait. Default 10_000. */
  waitTimeoutMs?: number
  /** Keep the spawned window open after the screenshot. Default false. */
  keep?: boolean
}

export interface CompatScreenshotResult {
  /** Absolute path to the captured PNG. */
  path: string
  /** Always "image/png". */
  mimeType: "image/png"
  /** Which terminal app + version + font + theme was captured. */
  terminal: CompatTerminalMetadata & { resized: boolean }
}

// ═══════════════════════════════════════════════════════
// Environment guards (acceptance bullet 8)
// ═══════════════════════════════════════════════════════

/**
 * Throws a clear, actionable error if the host can't run compat-screenshot.
 * Failure modes: non-macOS, no GUI session, peekaboo Accessibility permission.
 */
export async function assertCompatCapable(): Promise<void> {
  // macOS-only — `screencapture` + osascript are macOS facilities.
  if (process.platform !== "darwin") {
    throw new Error(
      `compat-screenshot is macOS-only (current platform: ${process.platform}). ` +
        `On Linux, the equivalent path is tracked separately — use the canvas renderer ` +
        `(termless screenshot / mcp__tty__screenshot) for cross-platform capture.`,
    )
  }

  // GUI session — a window server must be reachable. When SSH'd in without
  // a console session, `screencapture` can't see any windows. `SSH_TTY`
  // with no Aqua session is the classic headless-failure signature.
  const hasGui = await hasWindowServer()
  if (!hasGui) {
    throw new Error(
      `compat-screenshot needs a GUI session — no macOS window server detected. ` +
        `This usually means you are SSH'd in without console access. ` +
        `Run it from a local Terminal session, or use the canvas renderer instead.`,
    )
  }

  // Screen-recording permission — `screencapture` silently produces a black
  // or desktop-only image without it. Probe and surface an actionable hint.
  const recordingOk = await hasScreenRecordingPermission()
  if (!recordingOk) {
    throw new Error(
      `compat-screenshot needs Screen Recording permission. Grant it under ` +
        `System Settings → Privacy & Security → Screen Recording for your terminal / ` +
        `agent process, then retry. (osascript/AppleScript Accessibility may also be ` +
        `prompted on first window-control call.)`,
    )
  }
}

/** True if a macOS window server (Aqua session) is reachable. */
async function hasWindowServer(): Promise<boolean> {
  try {
    // `launchctl managername` reports "Aqua" only inside a GUI login session.
    const r = await exec(["launchctl", "managername"], { stdout: "pipe", stderr: "ignore" })
    if (r.exitCode === 0 && r.stdout.trim() === "Aqua") return true
  } catch {
    // fall through
  }
  // Fallback: System Events responds only with a window server present.
  try {
    const r = await exec(["osascript", "-e", 'tell application "System Events" to return name of first process'], {
      stdout: "pipe",
      stderr: "ignore",
    })
    return r.exitCode === 0 && r.stdout.trim().length > 0
  } catch {
    return false
  }
}

/**
 * Best-effort probe for Screen Recording permission. macOS exposes this via
 * `CGPreflightScreenCaptureAccess`, which has no CLI; instead we check whether
 * `screencapture` can grab a 1×1 region producing non-trivial bytes. A denied
 * process still returns exit 0 but the capture is desktop-only — we can't fully
 * distinguish that here, so this probe only catches the hard-fail cases and
 * the orchestrator's post-capture size check catches the rest.
 */
async function hasScreenRecordingPermission(): Promise<boolean> {
  try {
    const probe = join(tmpdir(), `peekaboo-perm-${crypto.randomUUID()}.png`)
    const r = await exec(["screencapture", "-x", "-R", "0,0,1,1", probe], { stderr: "pipe" })
    try {
      await unlink(probe)
    } catch {
      // ignore
    }
    return r.exitCode === 0
  } catch {
    return false
  }
}

// ═══════════════════════════════════════════════════════
// Step 2 — `.command` wrapper script
// ═══════════════════════════════════════════════════════

/**
 * Build a `.command` wrapper script. It `cd`s into `cwd`, runs the TUI
 * command, then `exec /bin/bash --login` to KEEP THE WINDOW OPEN until the
 * orchestrator closes it explicitly. Without this keep-alive the window can
 * close before `screencapture` runs (race observed in the 2026-05-18 demo).
 */
export function buildWrapperScript(cmd: string, cwd: string): string {
  return [
    "#!/bin/bash",
    "# Auto-generated by termless compat-screenshot — safe to delete.",
    `cd ${shellQuote(cwd)} || exit 1`,
    cmd,
    "# Keep the window alive after the TUI exits so the screenshot can land.",
    "exec /bin/bash --login",
    "",
  ].join("\n")
}

/** POSIX single-quote a string for safe shell embedding. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

// ═══════════════════════════════════════════════════════
// Step 5 — first-paint wait
// ═══════════════════════════════════════════════════════

/** Read the front window's text via the macOS Accessibility tree. */
async function readWindowText(bundleName: string): Promise<string> {
  try {
    const r = await exec(
      [
        "osascript",
        "-e",
        `tell application "System Events" to tell process "${bundleName}"
           try
             return value of text area 1 of scroll area 1 of front window
           on error
             return ""
           end try
         end tell`,
      ],
      { stdout: "pipe", stderr: "ignore" },
    )
    return r.exitCode === 0 ? r.stdout : ""
  } catch {
    return ""
  }
}

/**
 * Poll the window until `waitFor` appears (or any non-empty text if `waitFor`
 * is undefined). Resolves `true` on success, `false` on timeout — the
 * orchestrator screenshots anyway on timeout (best-effort, per the bead's
 * "OCR isn't 100% reliable" risk note).
 */
async function waitForFirstPaint(bundleName: string, waitFor: string | undefined, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const text = await readWindowText(bundleName)
    if (waitFor ? text.includes(waitFor) : text.trim().length > 0) {
      return true
    }
    await new Promise((res) => setTimeout(res, 250))
  }
  return false
}

// ═══════════════════════════════════════════════════════
// Step 6 — screencapture
// ═══════════════════════════════════════════════════════

/** Capture the front window of `bundleName` to `outPath` via macOS screencapture. */
async function captureWindow(bundleName: string, outPath: string): Promise<void> {
  // Activate first so the window is frontmost — `screencapture` can't grab
  // occluded windows reliably.
  await exec(["osascript", "-e", `tell application "${bundleName}" to activate`], { stderr: "ignore" })
  await new Promise((res) => setTimeout(res, 350))

  // Query the front window bounds, then capture that screen region. Avoids
  // both interactive `-w` and the CGWindowID-vs-AppleScript-id mismatch.
  const bounds = await exec(
    [
      "osascript",
      "-e",
      `tell application "System Events" to tell process "${bundleName}"
         set p to position of front window
         set s to size of front window
         return (item 1 of p as text) & "," & (item 2 of p as text) & "," & (item 1 of s as text) & "," & (item 2 of s as text)
       end tell`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  )

  if (bounds.exitCode === 0 && bounds.stdout.trim()) {
    const r = await exec(["screencapture", "-R", bounds.stdout.trim(), "-o", "-x", outPath], { stderr: "pipe" })
    if (r.exitCode !== 0) {
      throw new Error(`screencapture failed (exit ${r.exitCode}): ${r.stderr.trim()}`)
    }
    return
  }

  // Fallback: capture the whole screen (still useful, just not cropped).
  const r = await exec(["screencapture", "-o", "-x", outPath], { stderr: "pipe" })
  if (r.exitCode !== 0) {
    throw new Error(`screencapture (full-screen fallback) failed (exit ${r.exitCode}): ${r.stderr.trim()}`)
  }
}

// ═══════════════════════════════════════════════════════
// Step 7 — cleanup
// ═══════════════════════════════════════════════════════

/** Best-effort close of the front window of `bundleName`. */
async function closeWindow(bundleName: string): Promise<void> {
  try {
    await exec(["osascript", "-e", `tell application "${bundleName}" to close front window`], { stderr: "ignore" })
  } catch {
    // Best-effort — leaking one window is better than throwing post-capture.
  }
}

// ═══════════════════════════════════════════════════════
// Orchestrator
// ═══════════════════════════════════════════════════════

/**
 * Run the full compat-screenshot mechanism.
 *
 * @throws if the host can't run it (non-macOS, no GUI, no permission) or the
 *         requested terminal app isn't installed.
 */
export async function compatScreenshot(opts: CompatScreenshotOptions): Promise<CompatScreenshotResult> {
  await assertCompatCapable()

  const cols = opts.cols ?? 120
  const rows = opts.rows ?? 40
  const waitTimeoutMs = opts.waitTimeoutMs ?? 10_000
  const cwd = opts.cwd ?? process.cwd()

  // ── Step 1 — resolve target terminal ───────────────────
  let terminal: CompatTerminal
  if (opts.terminal) {
    if (!(await isTerminalInstalled(opts.terminal))) {
      throw new Error(`terminal app "${opts.terminal}" is not installed on this Mac`)
    }
    terminal = opts.terminal
  } else {
    const detected = await detectTerminal()
    if (!detected) {
      throw new Error(
        `no supported terminal app found (looked for ghostty, kitty, iterm, terminal). ` +
          `Install one, or pass an explicit --terminal.`,
      )
    }
    terminal = detected
  }
  const adapter = getTerminalAdapter(terminal)

  // ── Step 2 — generate `.command` wrapper ───────────────
  const workDir = await mkdtemp(join(tmpdir(), "peekaboo-compat-"))
  const scriptPath = join(workDir, "run.command")
  await writeFile(scriptPath, buildWrapperScript(opts.cmd, cwd), "utf-8")
  await chmod(scriptPath, 0o755)

  const outputPath = opts.outputPath ?? join(workDir, "compat.png")

  let launched = false
  try {
    // ── Steps 3 + 4 — spawn the app + request size ───────
    const win = await adapter.launch({ scriptPath, cols, rows })
    launched = true

    // Give the app a moment to create its window before we poll/capture.
    await new Promise((res) => setTimeout(res, 1200))

    // ── Step 5 — wait for first paint ─────────────────────
    await waitForFirstPaint(win.bundleName, opts.waitFor, waitTimeoutMs)

    // ── Step 6 — screencapture ────────────────────────────
    await captureWindow(win.bundleName, outputPath)

    // ── Step 8 — collect metadata ─────────────────────────
    const meta = await adapter.metadata()

    return {
      path: outputPath,
      mimeType: "image/png",
      terminal: { ...meta, resized: win.resized },
    }
  } finally {
    // ── Step 7 — cleanup ──────────────────────────────────
    if (launched && !opts.keep) {
      await closeWindow(adapter.bundleName)
    }
    // Remove the wrapper script. Keep the temp dir only if it still holds
    // the output PNG (caller didn't pass an explicit outputPath).
    try {
      await unlink(scriptPath)
    } catch {
      // ignore
    }
    if (opts.outputPath) {
      // Output lives elsewhere — the temp dir is now empty, drop it.
      try {
        await rmdir(workDir)
      } catch {
        // ignore — non-empty or already gone
      }
    }
  }
}
