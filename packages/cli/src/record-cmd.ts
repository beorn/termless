/**
 * `termless record` — tape recorder for terminal sessions.
 *
 * Combines the old `capture`, `record`, and `tape record` commands into one.
 * Supports scripted mode (-t) for inline tape commands, or interactive mode
 * for recording a live session.
 *
 * @example
 * ```bash
 * # Record a command (scripted)
 * termless record -t 'Type "hello"\nEnter\nScreenshot' bash
 *
 * # Record with output file (format detected from extension)
 * termless record -o demo.tape bash
 *
 * # Capture-style: run a command, press keys, take a screenshot
 * termless record --keys j,j,Enter --screenshot /tmp/out.svg bun km view /path
 *
 * # SVG frame recording (replaces old `termless record --format frames`)
 * termless record -o ./frames/ --interval 100 --duration 5 htop
 * ```
 */

import type { Command } from "@silvery/commander"

const parseNum = (v: string) => parseInt(v, 10)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { parseTape } from "../../../src/tape/parser.ts"
import { executeTape } from "../../../src/tape/executor.ts"
import { overlayKeystroke } from "../../../src/tape/overlay.ts"
import { createSessionManager } from "./session.ts"

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

/** Check if any output path has an image extension */
function hasImageOutput(paths: string[]): boolean {
  return paths.some((p) => /\.(gif|svg|png|apng)$/i.test(p))
}

async function interactiveRecord(
  command: string[] | undefined,
  opts: { output?: string[]; cols: number; rows: number; raw?: boolean; showKeys?: boolean },
): Promise<void> {
  const shell = process.env.SHELL ?? "bash"
  const cmd = command ?? [shell]
  const outputPaths = opts.output ?? []
  const raw = opts.raw ?? false
  const showKeys = opts.showKeys ?? false
  const wantImages = hasImageOutput(outputPaths)
  const termFont = detectTerminalFont()
  const svgOpts = termFont ? { fontFamily: `'${termFont}', monospace` } : undefined

  const cmdLabel = cmd.join(" ")

  // Styled separator + info (stderr, won't appear in .tape stdout)
  process.stderr.write(`\x1b[2m${"─".repeat(60)}\x1b[22m\n`)
  process.stderr.write(`\x1b[31m●\x1b[0m Recording: ${cmdLabel}\n`)
  process.stderr.write(`\x1b[2m  ${opts.cols}x${opts.rows}`)
  process.stderr.write(` · ${outputPaths.join(", ") || "stdout (.tape)"}`)
  if (wantImages) process.stderr.write(` · frames`)
  process.stderr.write(`\n`)
  process.stderr.write(`  Ctrl+D or exit app to stop\x1b[22m\n`)
  process.stderr.write(`\x1b[2m${"─".repeat(60)}\x1b[22m\n`)

  const { spawnPty } = await import("../../../src/pty.ts")

  const inputEvents: Array<{ time: number; bytes: Uint8Array }> = []
  const outputEvents: Array<{ time: number; data: string }> = []
  const startTime = Date.now()

  // Window title with live timer (invisible in recording — only on real terminal)
  const setTitle = (t: string) => process.stderr.write(`\x1b]0;${t}\x07`)
  setTitle(`● REC — ${cmdLabel}`)
  const titleTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000)
    const m = Math.floor(elapsed / 60)
    const s = elapsed % 60
    setTitle(`● REC ${m}:${String(s).padStart(2, "0")} — ${cmdLabel}`)
  }, 1000)

  // If image output is requested, create a headless terminal that mirrors PTY output
  let headlessTerminal: import("../../../src/types.ts").Terminal | null = null
  const animationFrames: import("../../../src/animation/types.ts").AnimationFrame[] = []
  let frameTimer: ReturnType<typeof setInterval> | null = null
  let lastFrameText = ""

  if (wantImages) {
    const { createTerminal } = await import("../../../src/terminal.ts")
    const { backend } = await import("../../../src/backends.ts")
    const b = await backend("vterm")
    headlessTerminal = createTerminal({ backend: b, cols: opts.cols, rows: opts.rows })
  }

  // Spawn with real PTY — capture output AND forward to terminal
  const pty = spawnPty({
    command: cmd,
    cols: opts.cols,
    rows: opts.rows,
    onData: (data: Uint8Array) => {
      // Record output event for asciicast
      outputEvents.push({ time: Date.now() - startTime, data: new TextDecoder().decode(data) })
      // Forward to real terminal
      process.stdout.write(data)
      // Feed into headless terminal for image capture
      if (headlessTerminal) {
        headlessTerminal.feed(new TextDecoder().decode(data))
      }
    },
  })

  // Track the latest keystroke label for overlay
  let currentKeystrokeLabel = ""

  // Start frame capture timer for image output
  if (headlessTerminal) {
    const captureInterval = 100 // ms
    let lastCaptureTime = Date.now()

    frameTimer = setInterval(() => {
      if (!headlessTerminal) return
      const currentText = headlessTerminal.getText()
      if (currentText !== lastFrameText) {
        let svg = headlessTerminal.screenshotSvg(svgOpts)
        if (showKeys && currentKeystrokeLabel) {
          svg = overlayKeystroke(svg, currentKeystrokeLabel)
        }
        const now = Date.now()
        // Set duration of previous frame
        if (animationFrames.length > 0) {
          animationFrames[animationFrames.length - 1]!.duration = now - lastCaptureTime
        }
        animationFrames.push({ svg, duration: captureInterval })
        lastFrameText = currentText
        lastCaptureTime = now
      }
    }, captureInterval)
  }

  // Intercept stdin in raw mode, forward to PTY, record keystrokes
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
  }
  process.stdin.resume()

  const stdinHandler = (chunk: Buffer) => {
    const bytes = new Uint8Array(chunk)
    inputEvents.push({ time: Date.now() - startTime, bytes: new Uint8Array(bytes) })

    // Update keystroke label for overlay
    if (showKeys) {
      const tapeCmdStr = bytesToTapeCommand(bytes, raw)
      if (tapeCmdStr !== null && tapeCmdStr !== SKIP) {
        currentKeystrokeLabel = tapeCmdStr
      } else if (tapeCmdStr === null && bytes.length === 1 && bytes[0]! >= 0x20 && bytes[0]! < 0x7f) {
        // Printable character
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
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (!pty.alive) {
        clearInterval(check)
        resolve()
      }
    }, 100)
  })

  // Cleanup timers
  clearInterval(titleTimer)
  if (frameTimer) clearInterval(frameTimer)
  process.stdin.removeListener("data", stdinHandler)
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false)
  }
  process.stdin.pause()

  // Capture final frame if headless terminal has changed
  if (headlessTerminal) {
    const finalText = headlessTerminal.getText()
    if (finalText !== lastFrameText) {
      const svg = headlessTerminal.screenshotSvg(svgOpts)
      animationFrames.push({ svg, duration: 100 })
    }
  }

  const duration = (Date.now() - startTime) / 1000

  // Restore window title + post-recording separator
  setTitle("")
  const m = Math.floor(duration / 60)
  const s = Math.floor(duration % 60)
  process.stderr.write(`\x1b[2m${"─".repeat(60)}\x1b[22m\n`)
  process.stderr.write(`\x1b[32m✓\x1b[0m Done · ${m}:${String(s).padStart(2, "0")}`)
  process.stderr.write(` · ${inputEvents.length} keystrokes · ${outputEvents.length} output events`)
  if (animationFrames.length > 0) process.stderr.write(` · ${animationFrames.length} frames`)
  process.stderr.write(`\n`)

  // Write to output files (or stdout)
  if (outputPaths.length === 0) {
    // No -o: output .tape to stdout
    process.stdout.write(eventsToTape(inputEvents, cmd.join(" "), raw))
  } else {
    for (const path of outputPaths) {
      if (/\.(gif|svg|png|apng)$/i.test(path)) {
        // Image output — render animation frames
        await writeImageOutput(path, animationFrames)
      } else if (path.endsWith(".cast")) {
        // asciicast v2 format — JSON-lines with output events
        const lines: string[] = []
        lines.push(
          JSON.stringify({
            version: 2,
            width: opts.cols,
            height: opts.rows,
            timestamp: Math.floor(Date.now() / 1000),
            duration,
            env: { SHELL: cmd[0] ?? "", TERM: "xterm-256color" },
          }),
        )
        for (const event of outputEvents) {
          lines.push(JSON.stringify([event.time / 1000, "o", event.data]))
        }
        for (const event of inputEvents) {
          lines.push(JSON.stringify([event.time / 1000, "i", new TextDecoder().decode(event.bytes)]))
        }
        // Sort by timestamp
        const header = lines[0]!
        const events = lines.slice(1).sort((a, b) => {
          const ta = (JSON.parse(a) as number[])[0]!
          const tb = (JSON.parse(b) as number[])[0]!
          return ta - tb
        })
        writeFileSync(path, [header, ...events].join("\n") + "\n")
        console.error(`Saved: ${path}`)
      } else if (path.endsWith(".tape")) {
        writeFileSync(path, eventsToTape(inputEvents, cmd.join(" "), raw))
        console.error(`Saved: ${path}`)
      } else {
        writeFileSync(path, eventsToTape(inputEvents, cmd.join(" "), raw))
        console.error(`Saved: ${path}`)
      }
    }
  }

  // Cleanup headless terminal
  if (headlessTerminal) {
    headlessTerminal.close()
  }

  console.error("  Done.")
}

/**
 * Write animation frames to an image output file.
 * Detects format from extension and uses the appropriate encoder.
 */
async function writeImageOutput(
  path: string,
  frames: import("../../../src/animation/types.ts").AnimationFrame[],
): Promise<void> {
  if (frames.length === 0) {
    console.error(`Warning: no frames captured for ${path}`)
    return
  }

  const dir = dirname(resolve(path))
  mkdirSync(dir, { recursive: true })

  if (path.endsWith(".gif")) {
    const { createGif } = await import("../../../src/animation/gif.ts")
    const gif = await createGif(frames)
    writeFileSync(resolve(path), gif)
  } else if (path.endsWith(".apng") || (path.endsWith(".png") && frames.length > 1)) {
    const { createApng } = await import("../../../src/animation/apng.ts")
    const apng = await createApng(frames)
    writeFileSync(resolve(path), apng)
  } else if (path.endsWith(".svg")) {
    const { createAnimatedSvg } = await import("../../../src/animation/animated-svg.ts")
    const svg = createAnimatedSvg(frames)
    writeFileSync(resolve(path), svg, "utf-8")
  } else if (path.endsWith(".png")) {
    // Single frame PNG — rasterize the SVG
    const resvg = await import("@resvg/resvg-js")
    const renderer = new resvg.Resvg(frames[frames.length - 1]!.svg, {
      fitTo: { mode: "zoom" as const, value: 2 },
      font: { loadSystemFonts: true, defaultFontFamily: "Menlo" },
    })
    const rendered = renderer.render()
    writeFileSync(resolve(path), rendered.asPng())
  }

  console.error(`Saved: ${path}`)
}

// =============================================================================
// Action
// =============================================================================

async function recordAction(
  command: string[],
  opts: {
    output?: string[]
    tape?: string
    fmt?: string
    backend?: string
    cols: number
    rows: number
    timeout: number
    text?: boolean
    keys?: string
    screenshot?: string
    waitFor?: string
    interval?: number
    duration?: string
    outputDir?: string
    format?: string
    raw?: boolean
    showKeys?: boolean
    theme?: string
  },
): Promise<void> {
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

    // Print terminal text if requested
    if (opts.text) {
      console.error(result.terminal.getText())
    }

    console.error(`Done in ${result.duration}ms (${result.screenshotCount} screenshot(s))`)
    await result.terminal.close()
    return
  }

  // ── SVG frame recording mode (--interval or --duration or --output-dir or --format) ──
  if (opts.interval || opts.duration || opts.outputDir || opts.format) {
    const { recordCommand } = await import("./record.ts")
    const cmd = command.length > 0 ? command : ["bash"]
    await recordCommand({
      command: cmd,
      cols: opts.cols,
      rows: opts.rows,
      interval: opts.interval ?? 100,
      duration: opts.duration ? Number.parseFloat(opts.duration) : null,
      outputDir: opts.outputDir ?? "./termless-recording/",
      format: (opts.format as "frames" | "html") ?? "frames",
    })
    return
  }

  // ── Interactive recording mode: -o <file> with a command (or shell) ──
  const hasOutputFile = opts.output && opts.output.length > 0
  const cmd = command.length > 0 ? command : undefined
  if (hasOutputFile && !opts.keys && !opts.screenshot && !opts.text) {
    await interactiveRecord(cmd, { ...opts, raw: opts.raw, showKeys: opts.showKeys })
    return
  }

  if (!cmd && !opts.keys && !opts.screenshot && !opts.text) {
    // No command, no output, no flags — show help
    console.error("Usage:")
    console.error("  termless record -o demo.tape ls -la         Record a command to .tape")
    console.error("  termless record -o demo.tape                Record shell session to .tape")
    console.error("  termless rec -t 'Type \"hello\"\\nEnter' bash  Scripted recording")
    console.error("  termless record --keys j,j,Enter --screenshot /tmp/out.svg bun km view")
    console.error("")
    console.error("  termless record --help                      Full options")
    process.exitCode = 1
    return
  }

  const manager = createSessionManager()

  try {
    const { terminal } = await manager.createSession({
      command: cmd,
      cols: opts.cols,
      rows: opts.rows,
      waitFor: opts.waitFor ?? "content",
      timeout: opts.timeout,
    })

    // Press keys if specified
    if (opts.keys) {
      const keys = opts.keys.split(",").map((k: string) => k.trim())
      for (const key of keys) {
        terminal.press(key)
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      // Wait for content to settle after key presses
      await terminal.waitForStable(200, opts.timeout)
    }

    // Save screenshot if requested (PNG if .png extension, otherwise SVG)
    if (opts.screenshot) {
      const { writeFile } = await import("node:fs/promises")
      if (opts.screenshot.endsWith(".png")) {
        const png = await terminal.screenshotPng()
        await writeFile(opts.screenshot, png)
      } else {
        const svg = terminal.screenshotSvg()
        await writeFile(opts.screenshot, svg, "utf-8")
      }
      console.error(`Screenshot saved: ${opts.screenshot}`)
    }

    // Print text if requested
    if (opts.text) {
      console.error(terminal.getText())
    }
  } finally {
    await manager.stopAll()
  }
}

// =============================================================================
// Registration
// =============================================================================

export function registerRecordCommand(program: Command): void {
  program
    .command("record")
    .argument("[command...]", "Command to record")
    .alias("rec")
    .description("Tape recorder — record terminal sessions")
    .option("-o, --output <path...>", "Output file(s), format by extension (repeat for multiple)")
    .option("-t, --tape <commands>", "Inline tape commands (scripted mode)")
    .option("--fmt <format>", "Output format for stdout: tape, cast (default: tape)")
    .option("-b, --backend <name>", "Backend name (default: vterm)")
    .option("--cols <n>", "Terminal columns", parseNum, 80)
    .option("--rows <n>", "Terminal rows", parseNum, 24)
    .option("--timeout <ms>", "Wait timeout in ms", parseNum, 5000)
    .option("--text", "Print terminal text to stdout")
    .option("--keys <keys>", "Comma-separated key names to press")
    .option("--screenshot <path>", "Save screenshot to path (SVG or PNG)")
    .option("--wait-for <text>", "Wait for text before pressing keys")
    .option("--interval <ms>", "Capture interval in ms (enables frame recording)", parseNum, 0)
    .option("--duration <seconds>", "Stop after N seconds (enables frame recording)", parseNum, 0)
    .option("--output-dir <path>", "Output directory for frame recording")
    .option("--format <type>", "Frame recording format: frames or html")
    .option("--raw", "Preserve terminal protocol responses (skip filtering)")
    .option("--show-keys", "Overlay keystroke badges on image frames")
    .option("--theme <name>", "Color theme for screenshots (e.g. dracula, nord, monokai)")
    .action(async (opts: { command: string[] } & Record<string, any>) => {
      const { command, ...rest } = opts
      await recordAction(command, rest as any)
    })
}
