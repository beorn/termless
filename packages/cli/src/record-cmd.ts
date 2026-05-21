/**
 * `termless record` — tape recorder for terminal sessions.
 *
 * `record` captures a terminal session and writes it to one or more output
 * files. The **only** output flag is `-o`; the *shape* of each value picks the
 * mode:
 *
 * @example
 * ```bash
 * # Bare record — shows a help gate, then records a live $SHELL on Enter.
 * termless record
 *
 * # Record a command. No -o → out.gif in the cwd.
 * termless record -- bun km view ~/Vault
 *
 * # Folder bundle — a trailing slash writes out.{rec,gif,cast,tape}.
 * termless record -o demos/ -- bun km view ~/Vault
 *
 * # Named files — -o is repeatable; the extension picks the format.
 * termless record -o demo.gif -o demo.cast -- bun km view ~/Vault
 *
 * # A single still PNG.
 * termless record -o shot.png -- bun km view ~/Vault
 *
 * # Compat capture — record in a real desktop terminal app (macOS).
 * termless record --compat -o c.png -- bun km view ~/Vault
 * ```
 *
 * README-fit defaults: backend `ghostty`, 80×30, ~12 fps, a ~300-frame cap.
 */

import type { Command } from "@silvery/commander"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { parseTape } from "../../../src/recording/tape/parser.ts"
import { executeTape } from "../../../src/recording/tape/executor.ts"
import { overlayKeystroke } from "../../../src/recording/tape/overlay.ts"
import { resolveOutputTargets } from "./output-targets.ts"
import { writeOutputs, type CapturedSession } from "./rec-writer.ts"
import { createFrameGate } from "./frame-gate.ts"
import { snapshotTerminal, snapshotReadable } from "../../../src/terminal/snapshot.ts"

const parseNum = (v: string) => parseInt(v, 10)
export const collectOutputPath = (value: string, previous: string[] = []): string[] => [...previous, value]

export const SAVE_TITLE_SEQUENCE = "\x1b[22;0t"
export const RESTORE_TITLE_SEQUENCE = "\x1b[23;0t"

// ── README-fit defaults ──────────────────────────────────────────────────────
//
// `record`'s defaults yield an artifact you can drop straight into a GitHub
// README or blog post. GitHub renders README images at ~880px content width —
// 80 columns keeps text readable; 30 rows fits real apps without dominating
// the page. ~12 fps reads smoothly and keeps file size down; the frame cap
// stops a long session producing a 50 MB GIF.
/** Default terminal columns — README content fits ~80. */
export const DEFAULT_COLS = 80
/** Default terminal rows — room for real apps without dominating the page. */
export const DEFAULT_ROWS = 30
/** Default capture frame rate, in frames per second (~12 fps). */
export const DEFAULT_FPS = 12
/** Hard cap on frames captured — a long session must not produce a 50 MB GIF. */
export const FRAME_CAP = 300
/**
 * Default raster resolution multiplier. `2` doubles the swash cell metrics —
 * an 80×30 grid (768×600 native) becomes 1536×1200, which GitHub downscales to
 * its ~880px content width as crisp 2× DPI. `--scale 1` writes native size for
 * a smaller file; `--scale 3`+ for print-grade stills.
 */
export const DEFAULT_SCALE = 2
/** Frame-capture interval in ms, derived from {@link DEFAULT_FPS}. */
const FRAME_INTERVAL_MS = Math.round(1000 / DEFAULT_FPS)

const BANNER_WIDTH = 60
const BANNER_LINE = "─".repeat(BANNER_WIDTH)

export interface RecordingStartOptions {
  cmdLabel: string
  cols: number
  rows: number
  outputPaths: string[]
  wantImages: boolean
}

export interface RecordingSavedOutput {
  path: string
  bytes: number
}

export interface RecordingSummaryOptions {
  durationMs: number
  inputEventCount: number
  outputEventCount: number
  frameCount?: number
  savedOutputs?: RecordingSavedOutput[]
}

function faint(text: string): string {
  return `\x1b[2m${text}\x1b[22m`
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function previewCommandFor(outputs: RecordingSavedOutput[]): string | undefined {
  const preview = outputs.find((output) => /\.(gif|svg|png|apng|html)$/i.test(output.path))
  return preview ? `open ${preview.path}` : undefined
}

export function formatRecordingStart(opts: RecordingStartOptions): string {
  const outputLabel = opts.outputPaths.length > 0 ? opts.outputPaths.join(", ") : "stdout (.tape)"
  const details = [`${opts.cols}x${opts.rows}`, outputLabel]
  if (opts.wantImages) details.push("frames")

  return (
    [
      faint(BANNER_LINE),
      `\x1b[31m●\x1b[0m Recording: ${opts.cmdLabel}`,
      faint(`  ${details.join(" · ")}`),
      faint("  Ctrl+D or exit app to stop"),
      faint(BANNER_LINE),
    ].join("\n") + "\n"
  )
}

export function formatRecordingSummary(opts: RecordingSummaryOptions): string {
  const parts = [
    plural(opts.inputEventCount, "keystroke"),
    plural(opts.outputEventCount, "output event"),
    formatDuration(opts.durationMs),
  ]
  if (opts.frameCount && opts.frameCount > 0) {
    parts.push(plural(opts.frameCount, "frame"))
  }

  const lines = [faint(BANNER_LINE), `\x1b[32m✓\x1b[0m Done (${parts.join(", ")})`]
  for (const output of opts.savedOutputs ?? []) {
    lines.push(`\x1b[32m✓\x1b[0m ${output.path} (${formatBytes(output.bytes)})`)
  }
  const preview = previewCommandFor(opts.savedOutputs ?? [])
  if (preview) lines.push(`Preview: ${preview}`)
  lines.push(faint(BANNER_LINE))

  return lines.join("\n") + "\n"
}

export function recordingTitle(cmdLabel: string, elapsedMs?: number): string {
  if (elapsedMs == null) return `● REC — ${cmdLabel}`

  const elapsed = Math.floor(elapsedMs / 1000)
  const m = Math.floor(elapsed / 60)
  const s = elapsed % 60
  return `● REC ${m}:${String(s).padStart(2, "0")} — ${cmdLabel}`
}

export function setTitleSequence(title: string): string {
  return `\x1b]0;${title.replace(/[\x00-\x1f\x7f]/g, " ")}\x07`
}

// =============================================================================
// Font detection
// =============================================================================

/** Try to detect the terminal's font from config files */
function detectTerminalFont(): string | undefined {
  // Ghostty
  const ghosttyConfig = `${process.env.HOME}/.config/ghostty/config`
  if (existsSync(ghosttyConfig)) {
    const content = readFileSync(ghosttyConfig, "utf-8")
    const match = content.match(/^font-family\s*=\s*(.+)$/m)
    if (match) return match[1]!.trim()
  }
  // TODO: add iTerm2, Alacritty, WezTerm, Kitty detection
  return undefined
}

// =============================================================================
// Key-to-tape mapping
// =============================================================================

/** Sentinel value indicating a terminal protocol response that should be filtered. */
export const SKIP = "__SKIP__"

/**
 * Check if bytes are a terminal protocol response that should be stripped.
 *
 * These are terminal → app responses that get captured during interactive
 * recording but shouldn't appear in .tape files:
 * - Kitty keyboard protocol: \x1b[?Nu, \x1b[N;...u
 * - OSC 4 palette queries: \x1b]4;N;rgb:...
 * - Focus events: \x1b[I, \x1b[O
 * - Device attribute responses: \x1b[?...c, \x1b[>...c
 * - Mouse report sequences: \x1b[<...M, \x1b[<...m
 * - DSR (Device Status Report) responses: \x1b[N;NR
 * - Mode report responses: \x1b[?...;...$y
 */
export function isTerminalResponse(bytes: Uint8Array, str: string): boolean {
  // Must start with ESC
  if (bytes.length < 2 || bytes[0] !== 0x1b) return false

  // Kitty keyboard protocol: \x1b[?Nu or \x1b[N;...u (ends with 'u')
  if (str.startsWith("\x1b[") && str.endsWith("u")) return true

  // Focus events: \x1b[I (focus in) and \x1b[O (focus out)
  if (str === "\x1b[I" || str === "\x1b[O") return true

  // Device attribute responses: \x1b[?...c (DA1) and \x1b[>...c (DA2)
  if (str.startsWith("\x1b[?") && str.endsWith("c")) return true
  if (str.startsWith("\x1b[>") && str.endsWith("c")) return true

  // Mouse report sequences: \x1b[<...M or \x1b[<...m (SGR mouse)
  if (str.startsWith("\x1b[<") && (str.endsWith("M") || str.endsWith("m"))) return true

  // OSC responses: \x1b]... terminated by BEL (\x07) or ST (\x1b\\)
  if (str.startsWith("\x1b]")) return true

  // DSR responses: \x1b[N;NR (cursor position report)
  if (/^\x1b\[\d+;\d+R$/.test(str)) return true

  // Mode report: \x1b[?...;...$y (DECRPM)
  if (str.startsWith("\x1b[?") && str.endsWith("$y")) return true

  return false
}

/** Map raw bytes to .tape commands. Returns null if unmappable (raw data), SKIP for terminal responses. */
export function bytesToTapeCommand(bytes: Uint8Array, raw = false): string | typeof SKIP | null {
  const str = new TextDecoder().decode(bytes)

  // Filter terminal protocol responses unless --raw mode
  if (!raw && isTerminalResponse(bytes, str)) {
    return SKIP
  }

  // Single printable character — accumulate for Type command
  if (bytes.length === 1) {
    const b = bytes[0]!
    if (b === 0x0d) return "Enter"
    if (b === 0x09) return "Tab"
    if (b === 0x1b) return "Escape"
    if (b === 0x7f) return "Backspace"
    if (b === 0x20) return "Space"
    if (b >= 1 && b <= 26) return `Ctrl+${String.fromCharCode(b + 0x60)}`
    if (b >= 0x20 && b < 0x7f) return null // printable — handled by Type accumulation
  }

  // Arrow keys and common escape sequences
  if (str === "\x1b[A") return "Up"
  if (str === "\x1b[B") return "Down"
  if (str === "\x1b[C") return "Right"
  if (str === "\x1b[D") return "Left"
  if (str === "\x1b[H") return "Home"
  if (str === "\x1b[F") return "End"
  if (str === "\x1b[3~") return "Delete"
  if (str === "\x1b[5~") return "PageUp"
  if (str === "\x1b[6~") return "PageDown"

  // Alt+key
  if (bytes.length === 2 && bytes[0] === 0x1b && bytes[1]! >= 0x20 && bytes[1]! < 0x7f) {
    return `Alt+${String.fromCharCode(bytes[1]!)}`
  }

  return null // unknown — skip in .tape output
}

/** Convert recorded events to .tape format string */
export function eventsToTape(events: Array<{ time: number; bytes: Uint8Array }>, shell: string, raw = false): string {
  const lines: string[] = []
  lines.push(`Set Shell "${shell}"`)
  lines.push("")

  let pendingType = ""
  let lastTime = 0

  function flushType() {
    if (pendingType) {
      // Escape quotes in the accumulated text
      const escaped = pendingType.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
      lines.push(`Type "${escaped}"`)
      pendingType = ""
    }
  }

  for (const event of events) {
    // Add Sleep if >200ms gap
    const gap = event.time - lastTime
    if (gap > 200) {
      flushType()
      if (gap >= 1000) {
        lines.push(`Sleep ${(gap / 1000).toFixed(1)}s`)
      } else {
        lines.push(`Sleep ${Math.round(gap)}ms`)
      }
    }
    lastTime = event.time

    const cmd = bytesToTapeCommand(event.bytes, raw)
    if (cmd === SKIP) {
      // Terminal protocol response — skip entirely
      continue
    } else if (cmd === null) {
      // Printable character — accumulate into Type
      const ch = new TextDecoder().decode(event.bytes)
      pendingType += ch
    } else {
      flushType()
      lines.push(cmd)
    }
  }

  flushType()
  lines.push("")
  return lines.join("\n")
}

// =============================================================================
// Interactive recording
// =============================================================================

/**
 * Interactive recording — spawn a command (or a bare `$SHELL`) under a real
 * PTY, capture input + output + SVG frames, then project the capture into
 * every requested {@link "./output-targets.ts".OutputTarget}.
 *
 * When `command` is `undefined` (bare `record`), a help gate runs first: it
 * explains what is about to be recorded and waits for Enter. The help is
 * pre-flight UI on the real terminal — never part of the recording.
 */
async function interactiveRecord(
  command: string[] | undefined,
  opts: {
    output?: string[]
    cols: number
    rows: number
    raw?: boolean
    showKeys?: boolean
    renderer?: string
    scale: number
  },
): Promise<void> {
  const shell = process.env.SHELL ?? "bash"
  const cmd = command ?? [shell]
  const raw = opts.raw ?? false
  const showKeys = opts.showKeys ?? false
  const renderer = (opts.renderer as "canvas" | "resvg" | "swash" | "browser" | "auto" | undefined) ?? "auto"
  const targets = resolveOutputTargets(opts.output ?? [])
  const outputPaths = targets.map((t) => t.path)
  const termFont = detectTerminalFont()
  const svgOpts = termFont ? { fontFamily: `'${termFont}', monospace` } : undefined

  const cmdLabel = cmd.join(" ")

  // ── Bare `record` → pre-flight help gate, then record on Enter ──
  if (command === undefined) {
    const { runHelpGate } = await import("./help-gate.tsx")
    await runHelpGate({ shell, cols: opts.cols, rows: opts.rows, outputs: outputPaths })
  }

  // Styled separator + info (stderr, won't appear in .tape stdout).
  process.stderr.write(
    formatRecordingStart({ cmdLabel, cols: opts.cols, rows: opts.rows, outputPaths, wantImages: true }),
  )

  const { spawnPty } = await import("../../../src/terminal/pty.ts")

  const inputEvents: Array<{ time: number; bytes: Uint8Array }> = []
  const outputEvents: Array<{ time: number; data: string }> = []
  const startTime = Date.now()

  // Window title with live timer (invisible in recording — only on real terminal).
  process.stderr.write(SAVE_TITLE_SEQUENCE)
  let titleRestored = false
  const restoreTitle = () => {
    if (titleRestored) return
    process.stderr.write(RESTORE_TITLE_SEQUENCE)
    titleRestored = true
  }
  const setTitle = (title: string) => process.stderr.write(setTitleSequence(title))
  setTitle(recordingTitle(cmdLabel))
  const titleTimer = setInterval(() => {
    setTitle(recordingTitle(cmdLabel, Date.now() - startTime))
  }, 1000)

  // Headless terminal that mirrors PTY output — the source for frame capture.
  const { createTerminal } = await import("../../../src/terminal/terminal.ts")
  const { backend } = await import("../../../src/backend/backends.ts")
  const b = await backend("ghostty")
  const headlessTerminal = createTerminal({ backend: b, cols: opts.cols, rows: opts.rows })

  const animationFrames: import("../../../src/view/animation-types.ts").AnimationFrame[] = []
  let frameTimer: ReturnType<typeof setInterval> | null = null
  let lastFrameText = ""
  let frameCapped = false

  // Spawn with real PTY — capture output AND forward to terminal
  // ONE streaming decoder for the whole PTY byte stream. A fresh
  // new-TextDecoder per chunk corrupts any multi-byte UTF-8 sequence
  // (box-drawing, arrows, emoji) that straddles a chunk boundary - each half
  // decodes to U+FFFD, surfacing as stray '?'-like marks on card borders. A
  // persistent decoder with { stream: true } buffers the partial sequence
  // until the next chunk completes it.
  const ptyDecoder = new TextDecoder()
  const pty = spawnPty({
    command: cmd,
    cols: opts.cols,
    rows: opts.rows,
    onData: (data: Uint8Array) => {
      const text = ptyDecoder.decode(data, { stream: true })
      // Record output event for asciicast
      outputEvents.push({ time: Date.now() - startTime, data: text })
      // Forward to real terminal (raw bytes - no decode round-trip)
      process.stdout.write(data)
      // Feed into headless terminal for image capture
      headlessTerminal.feed(text)
    },
  })

  // Track the latest keystroke label for overlay
  let currentKeystrokeLabel = ""
  let stdinHandler: ((chunk: Buffer) => void) | null = null

  try {
    // Frame capture timer — ~12 fps, capped at FRAME_CAP frames. A first-paint
    // gate (see ./frame-gate.ts) drops pre-UI lead-in noise so frame 0 is the
    // first real painted frame, not a shell echo or a blank buffer.
    let lastCaptureTime = Date.now()
    const frameGate = createFrameGate()
    frameTimer = setInterval(() => {
      if (animationFrames.length >= FRAME_CAP) {
        frameCapped = true
        return
      }
      const altScreen = headlessTerminal.getMode("altScreen")
      // A TUI that has left the alt screen has exited — anything it paints now
      // is the restored shell, not a recording frame. Stop capturing.
      if (frameGate.enteredAltScreen() && !altScreen) return
      const currentText = headlessTerminal.getText()
      const { capture, resetPrior } = frameGate.observe(currentText, altScreen)
      if (resetPrior) {
        // The command just entered the alt screen — everything captured so far
        // was pre-UI noise. Discard it; this paint becomes frame 0.
        animationFrames.length = 0
        lastFrameText = ""
        lastCaptureTime = Date.now()
      }
      if (!capture) return
      if (currentText !== lastFrameText) {
        let svg = headlessTerminal.screenshotSvg(svgOpts)
        if (showKeys && currentKeystrokeLabel) {
          svg = overlayKeystroke(svg, currentKeystrokeLabel)
        }
        const now = Date.now()
        if (animationFrames.length > 0) {
          animationFrames[animationFrames.length - 1]!.duration = now - lastCaptureTime
        }
        animationFrames.push({
          svg,
          snapshot: snapshotReadable(snapshotTerminal(headlessTerminal)),
          duration: FRAME_INTERVAL_MS,
        })
        lastFrameText = currentText
        lastCaptureTime = now
      }
    }, FRAME_INTERVAL_MS)

    // Intercept stdin in raw mode, forward to PTY, record keystrokes
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true)
    }
    process.stdin.resume()

    stdinHandler = (chunk: Buffer) => {
      const bytes = new Uint8Array(chunk)
      inputEvents.push({ time: Date.now() - startTime, bytes: new Uint8Array(bytes) })

      // Update keystroke label for overlay
      if (showKeys) {
        const tapeCmdStr = bytesToTapeCommand(bytes, raw)
        if (tapeCmdStr !== null && tapeCmdStr !== SKIP) {
          currentKeystrokeLabel = tapeCmdStr
        } else if (tapeCmdStr === null && bytes.length === 1 && bytes[0]! >= 0x20 && bytes[0]! < 0x7f) {
          currentKeystrokeLabel = new TextDecoder().decode(bytes)
        }
      }

      try {
        pty.write(new TextDecoder().decode(bytes))
      } catch {
        // PTY may have closed
      }
    }
    process.stdin.on("data", stdinHandler)

    // Wait for PTY to exit
    await new Promise<void>((resolveExit) => {
      const check = setInterval(() => {
        if (!pty.alive) {
          clearInterval(check)
          resolveExit()
        }
      }, 100)
    })

    // Capture final frame if the headless terminal changed since the last
    // tick — but skip the post-exit screen: a TUI that exits restores the
    // shell, and that restored primary screen is not a real recording frame.
    const finalText = headlessTerminal.getText()
    const tuiExited = frameGate.enteredAltScreen() && !headlessTerminal.getMode("altScreen")
    if (
      finalText.trim().length > 0 &&
      !tuiExited &&
      finalText !== lastFrameText &&
      animationFrames.length < FRAME_CAP
    ) {
      const svg = headlessTerminal.screenshotSvg(svgOpts)
      animationFrames.push({
        svg,
        snapshot: snapshotReadable(snapshotTerminal(headlessTerminal)),
        duration: FRAME_INTERVAL_MS,
      })
    }

    const durationMs = Date.now() - startTime

    // Restore the previous terminal title before writing summaries or artifacts.
    restoreTitle()

    if (frameCapped) {
      process.stderr.write(faint(`  frame cap (${FRAME_CAP}) reached — recording truncated\n`))
    }

    // Project the capture into every requested output.
    const session: CapturedSession = {
      cols: opts.cols,
      rows: opts.rows,
      durationMs,
      command: cmd,
      inputEvents,
      outputEvents,
      frames: animationFrames,
      renderer,
      scale: opts.scale,
    }
    const savedOutputs = await writeOutputs(targets, session, (s) =>
      eventsToTape(s.inputEvents, s.command.join(" "), raw),
    )

    process.stderr.write(
      formatRecordingSummary({
        durationMs,
        inputEventCount: inputEvents.length,
        outputEventCount: outputEvents.length,
        frameCount: animationFrames.length,
        savedOutputs,
      }),
    )
  } finally {
    clearInterval(titleTimer)
    if (frameTimer) clearInterval(frameTimer)
    if (stdinHandler) {
      process.stdin.removeListener("data", stdinHandler)
    }
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false)
    }
    process.stdin.pause()
    restoreTitle()
    headlessTerminal.close()
  }
}

// =============================================================================
// Compat recording — record against the peekaboo backend (a real desktop
// terminal app). Folds in the old `compat-screenshot` command: it was never a
// distinct verb, just `record` against the peekaboo backend.
// =============================================================================

/** Valid terminal-app names for `record --compat`. */
export const COMPAT_TERMINALS = ["ghostty", "kitty", "iterm", "terminal"] as const

/**
 * Compat recording — `record` against the peekaboo backend (a real desktop
 * terminal app). Folds in the old `compat-screenshot` command. Exported for
 * unit testing of the input-validation guards.
 */
export async function compatRecord(
  command: string[],
  opts: { terminal?: string; output?: string[]; cols: number; rows: number; cwd?: string; waitFor?: string },
): Promise<void> {
  if (command.length === 0) {
    console.error("Error: --compat needs a command. Pass the TUI command after `--`.")
    console.error("  termless record --compat -- bun km view ~/Vault")
    process.exitCode = 1
    return
  }

  if (opts.terminal && !(COMPAT_TERMINALS as readonly string[]).includes(opts.terminal)) {
    console.error(`Error: unknown --terminal "${opts.terminal}". Valid: ${COMPAT_TERMINALS.join(", ")}.`)
    process.exitCode = 1
    return
  }

  const { compatScreenshot } = await import("@termless/peekaboo")

  try {
    const result = await compatScreenshot({
      cmd: command.join(" "),
      terminal: opts.terminal as (typeof COMPAT_TERMINALS)[number] | undefined,
      outputPath: opts.output?.[0],
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      waitFor: opts.waitFor,
    })

    console.log(`Saved: ${result.path}`)
    console.log("Captured terminal:")
    console.log(`  app:     ${result.terminal.name}`)
    console.log(`  version: ${result.terminal.version ?? "(unknown)"}`)
    console.log(`  font:    ${result.terminal.font ?? "(unknown)"}`)
    console.log(`  theme:   ${result.terminal.theme ?? "(unknown)"}`)
    console.log(`  resized: ${result.terminal.resized ? "yes" : "no (used app default size)"}`)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}

// =============================================================================
// Action
// =============================================================================

async function recordAction(
  command: string[],
  opts: {
    output?: string[]
    tape?: string
    backend?: string
    cols: number
    rows: number
    timeout: number
    text?: boolean
    keys?: string
    waitFor?: string
    raw?: boolean
    showKeys?: boolean
    theme?: string
    renderer?: string
    scale: number
    compat?: boolean
    terminal?: string
    cwd?: string
  },
): Promise<void> {
  // Clamp --scale: a garbage value (NaN / 0 / negative) would produce a
  // zero-area or inverted bitmap. Fall back to the README-fit default.
  if (!Number.isFinite(opts.scale) || opts.scale < 1) {
    opts.scale = DEFAULT_SCALE
  }

  // ── Compat mode: record against the peekaboo backend (real desktop terminal) ──
  if (opts.compat) {
    await compatRecord(command, {
      terminal: opts.terminal,
      output: opts.output,
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      waitFor: opts.waitFor,
    })
    return
  }

  // ── Scripted mode: inline tape commands ──
  if (opts.tape) {
    const source = opts.tape.replace(/\\n/g, "\n")
    const tape = parseTape(source)
    const backendName = opts.backend

    console.error("Recording (scripted mode)...")

    const result = await executeTape(tape, {
      backend: backendName,
      cols: opts.cols,
      rows: opts.rows,
      theme: opts.theme,
      onScreenshot: (png, path) => {
        const outPath = path ?? opts.output?.[0] ?? "screenshot.png"
        const dir = dirname(resolve(outPath))
        mkdirSync(dir, { recursive: true })
        writeFileSync(resolve(outPath), png)
        console.error(`Screenshot saved: ${outPath}`)
      },
    })

    if (opts.text) {
      console.error(result.terminal.getText())
    }

    console.error(`Done in ${result.duration}ms (${result.screenshotCount} screenshot(s))`)
    await result.terminal.close()
    return
  }

  // ── --keys mode: spawn, press keys, capture a single still ──
  if (opts.keys) {
    const { createSessionManager } = await import("./session.ts")
    const manager = createSessionManager()
    try {
      const { terminal } = await manager.createSession({
        command: command.length > 0 ? command : undefined,
        cols: opts.cols,
        rows: opts.rows,
        waitFor: opts.waitFor ?? "content",
        timeout: opts.timeout,
      })
      const keys = opts.keys.split(",").map((k: string) => k.trim())
      for (const key of keys) {
        terminal.press(key)
        await new Promise((r) => setTimeout(r, 50))
      }
      await terminal.waitForStable(200, opts.timeout)
      const targets = resolveOutputTargets(opts.output ?? [])
      for (const target of targets) {
        mkdirSync(dirname(resolve(target.path)), { recursive: true })
        if (target.format === "png") {
          writeFileSync(
            resolve(target.path),
            await terminal.screenshot({ renderer: (opts.renderer as never) ?? "auto", dpr: opts.scale }),
          )
        } else if (target.format === "svg") {
          writeFileSync(resolve(target.path), terminal.screenshotSvg(), "utf-8")
        } else {
          console.error(`Error: --keys produces a still — use -o <file>.png or .svg, not .${target.format}.`)
          process.exitCode = 1
          return
        }
        console.error(`Saved: ${target.path}`)
      }
      if (opts.text) console.error(terminal.getText())
    } finally {
      await manager.stopAll()
    }
    return
  }

  // ── Interactive recording — the default path ──
  //
  // A bare `record` (no command) shows a help gate, then records `$SHELL`;
  // `record -- <cmd>` records the command directly with no gate.
  const cmd = command.length > 0 ? command : undefined
  await interactiveRecord(cmd, {
    output: opts.output,
    cols: opts.cols,
    rows: opts.rows,
    raw: opts.raw,
    showKeys: opts.showKeys,
    renderer: opts.renderer,
    scale: opts.scale,
  })
}

// =============================================================================
// Registration
// =============================================================================

export function registerRecordCommand(program: Command): void {
  const cmd = program
    .command("record")
    .alias("rec")
    .description("Record a terminal session — to a GIF, a .rec, a folder bundle, or more")
    .argument("[command...]", "Command to record (after `--`). Omit to record a live $SHELL.")
    .option(
      "-o, --output <path>",
      "Output path — extension picks the format, trailing / a folder bundle (repeatable)",
      collectOutputPath,
      [],
    )
    .option("-t, --tape <commands>", "Inline tape commands (scripted mode)")
    .option("-b, --backend <name>", "Backend name for scripted mode (default: vterm)")
    .option(
      "--renderer <kind>",
      "Raster renderer: canvas, resvg, swash, browser, or auto (default: auto). " +
        "browser is opt-in premium (headless Chromium — needs playwright installed).",
      "auto",
    )
    .option("--cols <n>", "Terminal columns", parseNum, DEFAULT_COLS)
    .option("--rows <n>", "Terminal rows", parseNum, DEFAULT_ROWS)
    .option(
      "--scale <n>",
      "Raster resolution multiplier for .gif/.apng/.png — 1 = native, 2 = retina",
      parseNum,
      DEFAULT_SCALE,
    )
    .option("--timeout <ms>", "Wait timeout in ms", parseNum, 5000)
    .option("--text", "Print terminal text to stdout")
    .option("--keys <keys>", "Comma-separated key names to press, then capture a still")
    .option("--wait-for <text>", "Wait for text before pressing keys")
    .option("--raw", "Preserve terminal protocol responses (skip filtering)")
    .option("--show-keys", "Overlay keystroke badges on image frames")
    .option("--theme <name>", "Color theme for screenshots (e.g. dracula, nord, monokai)")
    .option("--compat", "Compat capture — record in a real desktop terminal app (macOS)")
    .option("--terminal <name>", "Compat terminal app: ghostty, kitty, iterm, terminal (with --compat)")
    .option("--cwd <path>", "Working directory for the recorded command (with --compat)")

  cmd.addHelpSection("Output (-o picks the mode by path shape):", [
    ["$ termless record -- bun km view ~/V", "No -o → out.gif in the cwd"],
    ["$ termless record -o demos/ -- bun km view", "Trailing / → folder: out.{rec,gif,cast,tape}"],
    ["$ termless record -o a.gif -o a.cast -- km", "Repeatable, extensioned → exactly those files"],
    ["$ termless record -o shot.png -- bun km view", "An extension → that single file"],
    ["$ termless record --scale 1 -o demo.gif -- km", "Native resolution (smaller file; default is 2×)"],
  ])

  cmd.addHelpSection("Compat capture (macOS, --compat):", [
    ["$ termless record --compat -- bun km view ~/Vault", "Capture a TUI in the real desktop terminal"],
    ["$ termless record --compat --terminal ghostty -o c.png -- bun km", "Explicit terminal app + output path"],
  ])

  cmd.actionMerged(async (opts: { command: string[] } & Record<string, any>) => {
    const { command, ...rest } = opts
    await recordAction(command, rest as any)
  })
}
