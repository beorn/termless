/**
 * Per-app terminal launchers for `compat-screenshot`.
 *
 * Each adapter knows how to:
 *  - launch its terminal app pointed at a `.command` wrapper script
 *  - request a window size (cols/rows) — best-effort, app-specific
 *  - report which macOS application bundle name it activates
 *  - extract a metadata blob (version + font + theme) from the app's config
 *
 * macOS-only. Linux is a separate sibling concern (grim / gnome-screenshot)
 * and intentionally out of scope here.
 *
 * Design note — why a `.command` wrapper:
 * Spawning a terminal app via `open -a <App> <script.command>` is the most
 * uniform launch path across Ghostty / kitty / iTerm / Terminal.app. The
 * wrapper script `cd`s, runs the TUI command, then `exec /bin/bash --login`
 * so the window STAYS OPEN after the command exits — without that keep-alive
 * the window can close before the screenshot lands (observed in the
 * 2026-05-18 demo).
 */

import { homedir } from "node:os"
import { exec } from "./exec.ts"
import type { TerminalApp } from "./backend.ts"

// ═══════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════

/** Terminal apps the compat-screenshot orchestrator can drive. */
export type CompatTerminal = "ghostty" | "kitty" | "iterm" | "terminal"

/** Auto-detect preference order (bead acceptance bullet 2). */
export const COMPAT_TERMINAL_PREFERENCE: readonly CompatTerminal[] = ["ghostty", "kitty", "iterm", "terminal"]

/** macOS application bundle name per terminal. */
const BUNDLE_NAMES: Record<CompatTerminal, string> = {
  ghostty: "Ghostty",
  kitty: "kitty",
  iterm: "iTerm",
  terminal: "Terminal",
}

/** Metadata describing the captured terminal (for traceability). */
export interface CompatTerminalMetadata {
  /** Terminal name as requested. */
  name: CompatTerminal
  /** App version string, or null if it couldn't be detected. */
  version: string | null
  /** Font family from the app's config, or null. */
  font: string | null
  /** Theme name from the app's config, or null. */
  theme: string | null
}

/** Options passed to an adapter's `launch()`. */
export interface AdapterLaunchOptions {
  /** Absolute path to the `.command` wrapper script. */
  scriptPath: string
  /** Requested terminal columns (best-effort sizing). */
  cols: number
  /** Requested terminal rows (best-effort sizing). */
  rows: number
}

/** A launched terminal window handle. */
export interface LaunchedWindow {
  /** macOS application bundle name (for `screencapture` / osascript). */
  bundleName: string
  /** Whether the requested size was actually honored by the app. */
  resized: boolean
}

/** Per-app launcher. */
export interface TerminalAdapter {
  readonly terminal: CompatTerminal
  readonly bundleName: string
  /** Launch the app pointed at the wrapper script. Returns once `open` returns. */
  launch(opts: AdapterLaunchOptions): Promise<LaunchedWindow>
  /** Detect version/font/theme from the app's config files. Best-effort. */
  metadata(): Promise<CompatTerminalMetadata>
}

// ═══════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════

/** True if a macOS application bundle is installed. */
export async function isTerminalInstalled(terminal: CompatTerminal): Promise<boolean> {
  const bundle = BUNDLE_NAMES[terminal]
  // `mdfind` locates the .app bundle anywhere; fall back to the standard
  // /Applications path probe if Spotlight is disabled.
  try {
    const r = await exec(["mdfind", `kMDItemCFBundleIdentifier == '*' && kMDItemDisplayName == '${bundle}.app'`], {
      stdout: "pipe",
      stderr: "pipe",
    })
    if (r.exitCode === 0 && r.stdout.trim()) return true
  } catch {
    // fall through to path probe
  }
  for (const dir of ["/Applications", `${homedir()}/Applications`]) {
    try {
      const r = await exec(["test", "-d", `${dir}/${bundle}.app`])
      if (r.exitCode === 0) return true
    } catch {
      // ignore
    }
  }
  return false
}

/** First installed terminal in preference order, or null if none found. */
export async function detectTerminal(): Promise<CompatTerminal | null> {
  for (const terminal of COMPAT_TERMINAL_PREFERENCE) {
    if (await isTerminalInstalled(terminal)) return terminal
  }
  return null
}

/** Read a file, returning "" on any error (config files are optional). */
async function readConfig(path: string): Promise<string> {
  try {
    const r = await exec(["cat", path], { stdout: "pipe", stderr: "ignore" })
    return r.exitCode === 0 ? r.stdout : ""
  } catch {
    return ""
  }
}

/** Run an app's `--version` and return the trimmed first line, or null. */
async function appVersion(argv: string[]): Promise<string | null> {
  try {
    const r = await exec(argv, { stdout: "pipe", stderr: "pipe" })
    const line = (r.stdout || r.stderr).split("\n")[0]?.trim()
    return line || null
  } catch {
    return null
  }
}

// ═══════════════════════════════════════════════════════
// Adapters
// ═══════════════════════════════════════════════════════

/**
 * Ghostty adapter.
 *
 * Window size: Ghostty honors `window-width` / `window-height` (in cells)
 * from its config. We pass them as `--window-width=` / `--window-height=`
 * CLI overrides which take precedence over the user's config file.
 */
function createGhosttyAdapter(): TerminalAdapter {
  const bundleName = BUNDLE_NAMES.ghostty
  return {
    terminal: "ghostty",
    bundleName,
    async launch({ scriptPath, cols, rows }: AdapterLaunchOptions): Promise<LaunchedWindow> {
      // `open -na Ghostty --args …` forwards CLI flags. Ghostty runs the
      // .command script as its shell command via `-e`.
      const r = await exec(
        ["open", "-na", bundleName, "--args", `--window-width=${cols}`, `--window-height=${rows}`, "-e", scriptPath],
        { stderr: "pipe" },
      )
      if (r.exitCode !== 0) {
        throw new Error(`failed to launch Ghostty: ${r.stderr.trim()}`)
      }
      return { bundleName, resized: true }
    },
    async metadata(): Promise<CompatTerminalMetadata> {
      const config = await readConfig(`${homedir()}/.config/ghostty/config`)
      const font = /^\s*font-family\s*=\s*(.+)$/m.exec(config)?.[1]?.trim() ?? null
      const theme = /^\s*theme\s*=\s*(.+)$/m.exec(config)?.[1]?.trim() ?? null
      const version = await appVersion(["/Applications/Ghostty.app/Contents/MacOS/ghostty", "--version"])
      return { name: "ghostty", version, font, theme }
    },
  }
}

/**
 * kitty adapter.
 *
 * Window size: kitty's `--override initial_window_width=…c` accepts a cell
 * count when suffixed with `c`. This is the most reliable per-app resize.
 */
function createKittyAdapter(): TerminalAdapter {
  const bundleName = BUNDLE_NAMES.kitty
  return {
    terminal: "kitty",
    bundleName,
    async launch({ scriptPath, cols, rows }: AdapterLaunchOptions): Promise<LaunchedWindow> {
      const r = await exec(
        [
          "open",
          "-na",
          bundleName,
          "--args",
          "--override",
          `initial_window_width=${cols}c`,
          "--override",
          `initial_window_height=${rows}c`,
          "/bin/bash",
          scriptPath,
        ],
        { stderr: "pipe" },
      )
      if (r.exitCode !== 0) {
        throw new Error(`failed to launch kitty: ${r.stderr.trim()}`)
      }
      return { bundleName, resized: true }
    },
    async metadata(): Promise<CompatTerminalMetadata> {
      const config = await readConfig(`${homedir()}/.config/kitty/kitty.conf`)
      const font = /^\s*font_family\s+(.+)$/m.exec(config)?.[1]?.trim() ?? null
      // kitty themes are usually included via `include current-theme.conf`.
      const theme = /^\s*include\s+(.*theme.*\.conf)\s*$/m.exec(config)?.[1]?.trim() ?? null
      const version = await appVersion(["kitty", "--version"])
      return { name: "kitty", version, font, theme }
    },
  }
}

/**
 * iTerm adapter.
 *
 * Window size: iTerm has no launch-time CLI size flag. We launch via
 * `open` then best-effort resize the front window with osascript
 * (`set columns`/`set rows` on the current session).
 */
function createITermAdapter(): TerminalAdapter {
  const bundleName = BUNDLE_NAMES.iterm
  return {
    terminal: "iterm",
    bundleName,
    async launch({ scriptPath, cols, rows }: AdapterLaunchOptions): Promise<LaunchedWindow> {
      const r = await exec(["open", "-na", bundleName, scriptPath], { stderr: "pipe" })
      if (r.exitCode !== 0) {
        throw new Error(`failed to launch iTerm: ${r.stderr.trim()}`)
      }
      // Best-effort resize: iTerm exposes columns/rows on the current session.
      let resized = false
      try {
        // Give the window a moment to appear before resizing.
        await new Promise((res) => setTimeout(res, 800))
        const resize = await exec(
          [
            "osascript",
            "-e",
            `tell application "iTerm2"
               tell current session of current window
                 set columns to ${cols}
                 set rows to ${rows}
               end tell
             end tell`,
          ],
          { stderr: "pipe" },
        )
        resized = resize.exitCode === 0
      } catch {
        resized = false
      }
      return { bundleName, resized }
    },
    async metadata(): Promise<CompatTerminalMetadata> {
      // iTerm stores config in a binary plist; surface what `defaults` can read.
      let font: string | null = null
      let theme: string | null = null
      try {
        const r = await exec(["defaults", "read", "com.googlecode.iterm2", "Normal Font"], {
          stdout: "pipe",
          stderr: "ignore",
        })
        if (r.exitCode === 0 && r.stdout.trim()) font = r.stdout.trim()
      } catch {
        // ignore
      }
      try {
        const r = await exec(["defaults", "read", "com.googlecode.iterm2", "Default Bookmark Guid"], {
          stdout: "pipe",
          stderr: "ignore",
        })
        if (r.exitCode === 0 && r.stdout.trim()) theme = r.stdout.trim()
      } catch {
        // ignore
      }
      const version = await appVersion([
        "defaults",
        "read",
        "/Applications/iTerm.app/Contents/Info.plist",
        "CFBundleShortVersionString",
      ])
      return { name: "iterm", version, font, theme }
    },
  }
}

/**
 * Terminal.app adapter.
 *
 * Window size: Terminal.app has no launch-time size flag. We launch via
 * `open` then best-effort resize the front window with osascript
 * (`set number of columns/rows of …`).
 */
function createTerminalAppAdapter(): TerminalAdapter {
  const bundleName = BUNDLE_NAMES.terminal
  return {
    terminal: "terminal",
    bundleName,
    async launch({ scriptPath, cols, rows }: AdapterLaunchOptions): Promise<LaunchedWindow> {
      const r = await exec(["open", "-na", bundleName, scriptPath], { stderr: "pipe" })
      if (r.exitCode !== 0) {
        throw new Error(`failed to launch Terminal.app: ${r.stderr.trim()}`)
      }
      let resized = false
      try {
        await new Promise((res) => setTimeout(res, 800))
        const resize = await exec(
          [
            "osascript",
            "-e",
            `tell application "Terminal"
               set number of columns of front window to ${cols}
               set number of rows of front window to ${rows}
             end tell`,
          ],
          { stderr: "pipe" },
        )
        resized = resize.exitCode === 0
      } catch {
        resized = false
      }
      return { bundleName, resized }
    },
    async metadata(): Promise<CompatTerminalMetadata> {
      let theme: string | null = null
      try {
        const r = await exec(["defaults", "read", "com.apple.Terminal", "Default Window Settings"], {
          stdout: "pipe",
          stderr: "ignore",
        })
        if (r.exitCode === 0 && r.stdout.trim()) theme = r.stdout.trim()
      } catch {
        // ignore
      }
      const version = await appVersion([
        "defaults",
        "read",
        "/System/Applications/Utilities/Terminal.app/Contents/Info.plist",
        "CFBundleShortVersionString",
      ])
      return { name: "terminal", version, font: null, theme }
    },
  }
}

const ADAPTER_FACTORIES: Record<CompatTerminal, () => TerminalAdapter> = {
  ghostty: createGhosttyAdapter,
  kitty: createKittyAdapter,
  iterm: createITermAdapter,
  terminal: createTerminalAppAdapter,
}

/** Get the adapter for a terminal. */
export function getTerminalAdapter(terminal: CompatTerminal): TerminalAdapter {
  return ADAPTER_FACTORIES[terminal]()
}

/** Map a `CompatTerminal` to the backend's `TerminalApp` enum (for window tracking). */
export function compatToTerminalApp(terminal: CompatTerminal): TerminalApp {
  return terminal === "iterm" ? "iterm2" : terminal
}
