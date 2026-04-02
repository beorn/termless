#!/usr/bin/env bun
/**
 * termless CLI — headless terminal capture, recording, and playback.
 *
 * @example
 * ```bash
 * # Record a terminal session (scripted)
 * termless record -t 'Type "hello"\nEnter\nScreenshot' bash
 *
 * # Play back a tape file
 * termless play demo.tape -o demo.png
 *
 * # Manage backends
 * termless backend list
 * termless backend install ghostty vterm
 *
 * # Health check
 * termless doctor
 *
 * # Start MCP server
 * termless mcp
 * ```
 */

import { Command } from "@silvery/commander"
import { registerRecordCommand } from "./record-cmd.ts"
import { registerPlayCommand } from "./play-cmd.ts"
import { registerBackendCommand } from "./backend-cmd.tsx"
import { registerDoctorCommand } from "./doctor-cmd.tsx"

const program = new Command()
  .name("termless")
  .description("Headless terminal capture, recording, and playback")
  .version("0.3.0")

registerRecordCommand(program)
registerPlayCommand(program)
registerBackendCommand(program)
registerDoctorCommand(program)

// ── mcp ──

program
  .command("mcp")
  .description("Start MCP stdio server for terminal sessions")
  .action(async () => {
    const { startMcpServer } = await import("./mcp.ts")
    await startMcpServer()
  })

program.parse()
