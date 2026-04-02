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

  // ── Capture mode: run a command, optionally press keys, take screenshots ──
  const cmd = command.length > 0 ? command : undefined
  if (!cmd && !opts.keys && !opts.screenshot && !opts.text) {
    // No command and no scripted mode — show help
    console.error("Interactive tape recording is not yet implemented.")
    console.error("")
    console.error("Usage:")
    console.error("  termless record -t 'Type \"hello\"\\nEnter\\nScreenshot' bash")
    console.error("  termless record --keys j,j,Enter --screenshot /tmp/out.svg bun km view /path")
    console.error("  termless record -o demo.tape bash")
    console.error("")
    console.error("See https://termless.dev/guide/recording for the full reference.")
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
