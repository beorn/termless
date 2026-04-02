/**
 * VHS .tape executor for termless.
 *
 * Executes parsed tape commands against a termless Terminal instance.
 * Supports both headless mode (feed raw data) and PTY mode (spawn a shell
 * and type into it).
 *
 * @example
 * ```ts
 * import { parseTape, executeTape } from "@termless/core"
 *
 * const tape = parseTape(`
 *   Set Shell "bash"
 *   Type "echo hello"
 *   Enter
 *   Sleep 1s
 *   Screenshot
 * `)
 *
 * const result = await executeTape(tape, {
 *   onScreenshot: (png) => writeFileSync("out.png", png),
 * })
 * ```
 */

import type { TapeFile, TapeCommand } from "./parser.ts"
import { parseDuration } from "./parser.ts"
import type { Terminal, SvgScreenshotOptions } from "../types.ts"
import { createTerminal } from "../terminal.ts"
import { screenshotPng } from "../png.ts"

// =============================================================================
// Types
// =============================================================================

export interface TapeExecutorOptions {
  /** Backend name (default: "vterm"). */
  backend?: string
  /** Override terminal columns. */
  cols?: number
  /** Override terminal rows. */
  rows?: number
  /** Default typing speed in ms between characters (default: 50). */
  defaultTypingSpeed?: number
  /** Directory for saving screenshots. */
  screenshotDir?: string
  /** Called after each visual change when recording is not hidden. */
  onFrame?: (frame: TapeFrame) => void
  /** Called when a Screenshot command is executed. */
  onScreenshot?: (png: Uint8Array, path?: string) => void
}

export interface TapeFrame {
  /** Milliseconds since execution start. */
  timestamp: number
  /** PNG screenshot data. */
  png: Uint8Array
}

export interface TapeResult {
  /** Total execution time in milliseconds. */
  duration: number
  /** Collected frames (when onFrame is provided and not hidden). */
  frames: TapeFrame[]
  /** Number of screenshots taken. */
  screenshotCount: number
  /** The terminal instance (still open for inspection). */
  terminal: Terminal
}

// =============================================================================
// Key name mapping (VHS key names -> termless key descriptors)
// =============================================================================

const VHS_KEY_MAP: Record<string, string> = {
  enter: "Enter",
  backspace: "Backspace",
  tab: "Tab",
  space: "Space",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  escape: "Escape",
  delete: "Delete",
  pageup: "PageUp",
  pagedown: "PageDown",
  home: "Home",
  end: "End",
}

/**
 * Map a VHS key name to a termless key string.
 */
function mapKeyName(vhsKey: string): string {
  return VHS_KEY_MAP[vhsKey.toLowerCase()] ?? vhsKey
}

// =============================================================================
// Executor
// =============================================================================

/**
 * Execute parsed tape commands against a termless Terminal.
 *
 * If the tape specifies a Shell (via `Set Shell`), spawns it as a PTY process.
 * Otherwise operates in headless mode (feed-only, useful for testing).
 *
 * Key behaviors:
 * - Type: feeds each character through the PTY with typing speed delay
 * - Enter/Tab/etc: sends the corresponding key press
 * - Ctrl+C: sends Ctrl+key combination
 * - Sleep: actual delay (setTimeout)
 * - Screenshot: captures PNG and invokes callback
 * - Set Width/Height: resizes terminal
 * - Hide/Show: toggles frame recording
 * - Source: recursively executes another tape file (requires readFile callback)
 */
export async function executeTape(tape: TapeFile, options?: TapeExecutorOptions): Promise<TapeResult> {
  const startTime = Date.now()
  const frames: TapeFrame[] = []
  let screenshotCount = 0
  let hidden = false

  // Resolve dimensions from settings or options
  const cols = options?.cols ?? (tape.settings.Width ? Number.parseInt(tape.settings.Width, 10) : 80)
  const rows = options?.rows ?? (tape.settings.Height ? Number.parseInt(tape.settings.Height, 10) : 24)
  const defaultSpeed = options?.defaultTypingSpeed ?? parseDurationSetting(tape.settings.TypingSpeed, 50)

  // Resolve backend
  const backendName = options?.backend ?? "vterm"
  const { backend } = await import("../backends.ts")
  const backendInstance = await backend(backendName)

  const terminal = createTerminal({
    backend: backendInstance,
    cols,
    rows,
  })

  // Spawn shell if specified
  const shell = tape.settings.Shell ? parseShellSetting(tape.settings.Shell) : null
  if (shell) {
    await terminal.spawn(shell)
    // Brief wait for shell to initialize
    await delay(100)
  }

  // Screenshot rendering options from settings
  const svgOptions: SvgScreenshotOptions = {}
  if (tape.settings.FontSize) svgOptions.fontSize = Number.parseInt(tape.settings.FontSize, 10)
  if (tape.settings.FontFamily) svgOptions.fontFamily = tape.settings.FontFamily

  // Execute commands
  for (const cmd of tape.commands) {
    await executeCommand(cmd, terminal, {
      defaultSpeed,
      svgOptions,
      hidden,
      startTime,
      frames,
      onFrame: options?.onFrame,
      onScreenshot: options?.onScreenshot,
      onScreenshotCount: () => screenshotCount++,
      onHide: () => {
        hidden = true
      },
      onShow: () => {
        hidden = false
      },
    })
  }

  return {
    duration: Date.now() - startTime,
    frames,
    screenshotCount,
    terminal,
  }
}

// =============================================================================
// Command execution
// =============================================================================

interface ExecuteContext {
  defaultSpeed: number
  svgOptions: SvgScreenshotOptions
  hidden: boolean
  startTime: number
  frames: TapeFrame[]
  onFrame?: (frame: TapeFrame) => void
  onScreenshot?: (png: Uint8Array, path?: string) => void
  onScreenshotCount: () => void
  onHide: () => void
  onShow: () => void
}

async function executeCommand(cmd: TapeCommand, terminal: Terminal, ctx: ExecuteContext): Promise<void> {
  switch (cmd.type) {
    case "output":
      // Output path is metadata — handled by the CLI layer
      break

    case "set":
      // Most settings are consumed at init time. Handle dynamic ones here.
      if (cmd.key === "Width" || cmd.key === "Height") {
        const newCols = cmd.key === "Width" ? Number.parseInt(cmd.value, 10) : terminal.cols
        const newRows = cmd.key === "Height" ? Number.parseInt(cmd.value, 10) : terminal.rows
        terminal.resize(newCols, newRows)
      }
      break

    case "type": {
      const speed = cmd.speed ?? ctx.defaultSpeed
      for (const char of cmd.text) {
        if (terminal.alive) {
          terminal.type(char)
        } else {
          terminal.feed(char)
        }
        if (speed > 0) await delay(speed)
      }
      break
    }

    case "key": {
      const keyName = mapKeyName(cmd.key)
      const count = cmd.count ?? 1
      for (let i = 0; i < count; i++) {
        if (terminal.alive) {
          terminal.press(keyName)
        } else {
          // In headless mode, feed the key's ANSI encoding directly
          const { keyToAnsi, parseKey } = await import("../key-mapping.ts")
          const ansi = keyToAnsi(parseKey(keyName))
          terminal.feed(ansi)
        }
        if (count > 1) await delay(50)
      }
      break
    }

    case "ctrl": {
      const keyStr = `Ctrl+${cmd.key}`
      if (terminal.alive) {
        terminal.press(keyStr)
      } else {
        const { keyToAnsi, parseKey } = await import("../key-mapping.ts")
        terminal.feed(keyToAnsi(parseKey(keyStr)))
      }
      break
    }

    case "alt": {
      const keyStr = `Alt+${cmd.key}`
      if (terminal.alive) {
        terminal.press(keyStr)
      } else {
        const { keyToAnsi, parseKey } = await import("../key-mapping.ts")
        terminal.feed(keyToAnsi(parseKey(keyStr)))
      }
      break
    }

    case "sleep":
      await delay(cmd.ms)
      break

    case "screenshot": {
      const png = await screenshotPng(terminal, ctx.svgOptions)
      ctx.onScreenshotCount()
      ctx.onScreenshot?.(png, cmd.path)

      if (!ctx.hidden) {
        const frame: TapeFrame = {
          timestamp: Date.now() - ctx.startTime,
          png,
        }
        ctx.frames.push(frame)
        ctx.onFrame?.(frame)
      }
      break
    }

    case "hide":
      ctx.onHide()
      break

    case "show":
      ctx.onShow()
      break

    case "source":
      // Source requires filesystem access — handled by the CLI layer.
      // In library usage, this is a no-op (users should pre-process sources).
      break

    case "require":
      // Require checks if a program exists — handled by the CLI layer.
      break
  }
}

// =============================================================================
// Helpers
// =============================================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseDurationSetting(value: string | undefined, defaultMs: number): number {
  if (!value) return defaultMs
  return parseDuration(value)
}

function parseShellSetting(value: string): string[] {
  // Remove quotes if present
  const cleaned = value.replace(/^["']|["']$/g, "")
  return cleaned.split(/\s+/)
}
