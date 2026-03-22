#!/usr/bin/env bun
/**
 * termless CLI — one-shot terminal capture, recording, and MCP server.
 *
 * @example
 * ```bash
 * # Capture SVG screenshot
 * termless capture --command "bun km view /path" --keys "j,j,Enter" --screenshot /tmp/out.svg --text
 *
 * # Capture PNG screenshot (detected from .png extension)
 * termless capture --command "bun km view /path" --keys "j,j,Enter" --screenshot /tmp/out.png
 *
 * # Text-only
 * termless capture --command "ls -la" --wait-for "total" --text
 *
 * # Record terminal session as SVG frames
 * termless record --command "htop" --duration 5 --format frames
 *
 * # Record as HTML slideshow
 * termless record --command "bun km view /path" --format html --output-dir ./demo.html
 *
 * # Start MCP server
 * termless mcp
 * ```
 */

import { Command } from "commander"
import { createSessionManager } from "./session.ts"
import { registerBackendsCommand } from "./backends-cmd.ts"
import { registerInstallCommand, registerUpgradeCommand } from "./install-cmd.ts"
import { registerDoctorCommand } from "./doctor-cmd.ts"

const program = new Command()
  .name("termless")
  .description("Headless terminal capture CLI and MCP server")
  .version("0.3.0")

// ── capture ──

program
  .command("capture")
  .description("Start a process, interact, and capture output")
  .requiredOption("--command <cmd>", "Command to run (split on spaces)")
  .option("--keys <keys>", "Comma-separated key names to press")
  .option("--wait-for <text>", "Wait for text before pressing keys (default: any content)")
  .option("--screenshot <path>", "Save screenshot to path (SVG or PNG, detected from extension)")
  .option("--text", "Print terminal text to stdout")
  .option("--cols <n>", "Terminal columns", "120")
  .option("--rows <n>", "Terminal rows", "40")
  .option("--timeout <ms>", "Wait timeout in ms", "5000")
  .action(async (opts) => {
    const cols = Number.parseInt(opts.cols, 10)
    const rows = Number.parseInt(opts.rows, 10)
    const timeout = Number.parseInt(opts.timeout, 10)
    const command = opts.command.split(/\s+/)

    const manager = createSessionManager()

    try {
      const { terminal } = await manager.createSession({
        command,
        cols,
        rows,
        waitFor: opts.waitFor ?? "content",
        timeout,
      })

      // Press keys if specified
      if (opts.keys) {
        const keys = opts.keys.split(",").map((k: string) => k.trim())
        for (const key of keys) {
          terminal.press(key)
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        // Wait for content to settle after key presses
        await terminal.waitForStable(200, timeout)
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
  })

// ── record ──

program
  .command("record")
  .description("Record a terminal session as SVG frames or HTML slideshow")
  .requiredOption("--command <cmd>", "Command to run (split on spaces)")
  .option("--cols <n>", "Terminal columns", "120")
  .option("--rows <n>", "Terminal rows", "40")
  .option("--interval <ms>", "Capture interval in ms", "100")
  .option("--duration <seconds>", "Stop after N seconds")
  .option("--output-dir <path>", "Output directory or file path", "./termless-recording/")
  .option("--format <type>", "Output format: frames or html", "frames")
  .action(async (opts) => {
    const { recordCommand } = await import("./record.ts")
    await recordCommand({
      command: opts.command.split(/\s+/),
      cols: Number.parseInt(opts.cols, 10),
      rows: Number.parseInt(opts.rows, 10),
      interval: Number.parseInt(opts.interval, 10),
      duration: opts.duration ? Number.parseFloat(opts.duration) : null,
      outputDir: opts.outputDir,
      format: opts.format as "frames" | "html",
    })
  })

// ── mcp ──

program
  .command("mcp")
  .description("Start MCP stdio server for terminal sessions")
  .action(async () => {
    const { startMcpServer } = await import("./mcp.ts")
    await startMcpServer()
  })

// ── backend management ──

registerBackendsCommand(program)
registerInstallCommand(program)
registerUpgradeCommand(program)
registerDoctorCommand(program)

program.parse()
