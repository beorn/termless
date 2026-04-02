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
 * termless backends list
 * termless backends install ghostty vterm
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

program.addHelpText(
  "after",
  `
Recording & Playback:
  $ termless record km view                       Record a command (outputs .tape to stdout)
  $ termless record -o demo.tape km view          Record to .tape file
  $ termless record -o demo.gif km view           Record + render animated GIF
  $ termless record -o demo.cast km view          Record to asciicast format
  $ termless rec -t 'Type "hello"\\nEnter' bash    Scripted recording (inline tape)
  $ termless play demo.tape                       Play back a .tape file
  $ termless play demo.cast                       Play back an asciicast recording
  $ termless play -o demo.gif demo.tape           Convert .tape to GIF
  $ termless play -b vterm,ghostty demo.tape      Cross-terminal comparison

Backends:
  $ termless backends list                         Show all 11 backends + install status
  $ termless backends install                      Install default backends
  $ termless backends install ghostty alacritty    Install specific backends
  $ termless backends update                       Check upstream for newer versions
  $ termless doctor                               Health check all installed backends
`,
)

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
