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

import type { Command } from "commander"

const parseNum = (v: string) => parseInt(v, 10)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, resolve, join } from "node:path"
import { parseTape } from "../../../src/tape/parser.ts"
import { executeTape } from "../../../src/tape/executor.ts"
import { createSessionManager } from "./session.ts"

// =============================================================================
// Key-to-tape mapping
// =============================================================================

/** Map raw bytes to .tape commands. Returns null if unmappable (raw data). */
function bytesToTapeCommand(bytes: Uint8Array): string | null {
  const str = new TextDecoder().decode(bytes)

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
function eventsToTape(events: Array<{ time: number; bytes: Uint8Array }>, shell: string): string {
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

    const cmd = bytesToTapeCommand(event.bytes)
    if (cmd === null) {
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

async function interactiveRecord(
  command: string[] | undefined,
  opts: { output?: string[]; cols: number; rows: number },
): Promise<void> {
  const shell = process.env.SHELL ?? "bash"
  const cmd = command ?? [shell]
  const outputPaths = opts.output ?? []

  console.error(`Recording: ${cmd.join(" ")}`)
  console.error(`Output: ${outputPaths.join(", ") || "stdout"}`)
  console.error("Exit the command to stop recording.\n")

  const events: Array<{ time: number; bytes: Uint8Array }> = []
  const startTime = Date.now()

  // Intercept stdin in raw mode, forward to child, record keystrokes
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
  }

  const child = Bun.spawn(cmd, {
    stdin: "pipe",
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, COLUMNS: String(opts.cols), LINES: String(opts.rows) },
  })

  // Forward raw stdin to child, recording each chunk
  process.stdin.resume()
  const stdinHandler = (chunk: Buffer) => {
    const bytes = new Uint8Array(chunk)
    events.push({ time: Date.now() - startTime, bytes: new Uint8Array(bytes) })
    child.stdin?.write(bytes)
  }
  process.stdin.on("data", stdinHandler)

  // Wait for child to exit
  await child.exited

  // Cleanup
  process.stdin.removeListener("data", stdinHandler)
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false)
  }
  process.stdin.pause()

  // Generate .tape output
  const tape = eventsToTape(events, cmd.join(" "))

  // Write to output files
  if (outputPaths.length === 0) {
    // No -o: output to stdout
    process.stdout.write(tape)
  } else {
    for (const path of outputPaths) {
      if (path.endsWith(".tape")) {
        writeFileSync(path, tape)
        console.log(`\nSaved: ${path}`)
      } else if (path.endsWith(".cast")) {
        // asciicast format — would need output recording too
        // For now, just save as .tape
        writeFileSync(path.replace(".cast", ".tape"), tape)
        console.log(`\nSaved: ${path.replace(".cast", ".tape")} (asciicast not yet supported for interactive recording)`)
      } else {
        writeFileSync(path, tape)
        console.log(`\nSaved: ${path}`)
      }
    }
  }

  console.log(`\nRecorded ${events.length} keystrokes in ${((Date.now() - startTime) / 1000).toFixed(1)}s`)
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
      console.log(result.terminal.getText())
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
    await interactiveRecord(cmd, opts)
    return
  }

  if (!cmd && !opts.keys && !opts.screenshot && !opts.text) {
    // No command, no output, no flags — show help
    console.log("Usage:")
    console.log("  termless record -o demo.tape ls -la         Record a command to .tape")
    console.log("  termless record -o demo.tape                Record shell session to .tape")
    console.log("  termless rec -t 'Type \"hello\"\\nEnter' bash  Scripted recording")
    console.log("  termless record --keys j,j,Enter --screenshot /tmp/out.svg bun km view")
    console.log("")
    console.log("  termless record --help                      Full options")
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
      console.log(terminal.getText())
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
    .command("record [command...]")
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
    .action(recordAction)
}
