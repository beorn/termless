#!/usr/bin/env bun
/**
 * termless CLI — one-shot terminal capture and MCP server.
 *
 * @example
 * ```bash
 * # Capture text + SVG screenshot
 * termless capture --command "bun km view /path" --keys "j,j,Enter" --screenshot /tmp/out.svg --text
 *
 * # Text-only
 * termless capture --command "ls -la" --wait-for "total" --text
 *
 * # Start MCP server
 * termless mcp
 * ```
 */

import { Command } from "commander"
import { createSessionManager } from "./session.ts"

const program = new Command()
  .name("termless")
  .description("Headless terminal capture CLI and MCP server")
  .version("0.1.0")

// ── capture ──

program
  .command("capture")
  .description("Start a process, interact, and capture output")
  .requiredOption("--command <cmd>", "Command to run (split on spaces)")
  .option("--keys <keys>", "Comma-separated key names to press")
  .option("--wait-for <text>", "Wait for text before pressing keys (default: any content)")
  .option("--screenshot <path>", "Save SVG screenshot to path")
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

      // Save SVG screenshot if requested
      if (opts.screenshot) {
        const svg = terminal.screenshotSvg()
        const { writeFile } = await import("node:fs/promises")
        await writeFile(opts.screenshot, svg, "utf-8")
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

// ── mcp ──

program
  .command("mcp")
  .description("Start MCP stdio server for terminal sessions")
  .action(async () => {
    const { startMcpServer } = await import("./mcp.ts")
    await startMcpServer()
  })

program.parse()
