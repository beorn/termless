#!/usr/bin/env node
/**
 * termless CLI — record, view, play, and compare terminal sessions.
 *
 * The four recording-domain verbs are `record`, `view`, `play`, and
 * `compare`; `backends`, `doctor`, `themes`, and `mcp` are the
 * config / diagnostic surfaces.
 *
 * @example
 * ```bash
 * # Record a terminal session — no -o → out.gif in the cwd
 * termless record -- bun km view ~/Vault
 *
 * # Play back a recording
 * termless play demo.tape
 *
 * # View a recording — scrub it in the browser
 * termless view ./mysession.rec
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
import { registerViewCommand } from "./view-cmd.ts"
import { registerPlayCommand } from "./play-cmd.ts"
import { registerCompareCommand } from "./compare-cmd.ts"
import { registerInspectCommand } from "./inspect-cmd.ts"
import { registerBackendCommand } from "./backend-cmd.tsx"
import { registerDoctorCommand } from "./doctor-cmd.tsx"

const program = new Command()
  .name("termless")
  .description("Record, view, play, and compare terminal sessions")
  .version("0.3.1")

program.addHelpSection("Recording verbs:", [
  ["$ termless record -- bun km view ~/V", "record — capture a session (no -o → out.gif)"],
  ["$ termless record -o demos/ -- bun km", "record — folder bundle: out.{rec,gif,cast,tape}"],
  ["$ termless record --compat -- bun km view ~/V", "record — compat capture in a real terminal (macOS)"],
  ["$ termless view ./mysession.rec", "view — scrub a recording in the browser"],
  ["$ termless view ./trace --format gif -o demo.gif", "view — animate a recording to a GIF"],
  ["$ termless play demo.tape", "play — re-execute a recording"],
  ["$ termless compare demo.tape -b vterm,ghostty", "compare — diff a recording across backends"],
  ["$ termless inspect demo.tape", "inspect — summarize a tape bundle"],
])

program.addHelpSection("Config & diagnostics:", [
  ["$ termless backends", "Show all backends + install status"],
  ["$ termless backends install ghostty alacritty", "Install specific backends"],
  ["$ termless doctor", "Health check all installed backends"],
  ["$ termless themes", "List color themes for recordings"],
  ["$ termless mcp", "Start the MCP stdio server"],
])

program.addHelpSection("Docs:", [["https://termless.dev/guide/recording", ""]])

registerRecordCommand(program)
registerViewCommand(program)
registerPlayCommand(program)
registerCompareCommand(program)
registerInspectCommand(program)
registerBackendCommand(program)
registerDoctorCommand(program)

// ── themes ──

program
  .command("themes")
  .description("List available color themes for recordings")
  .action(async () => {
    const { listThemes, listAliases, resolveTheme } = await import("../../../src/recording/tape/themes.ts")
    const themes = listThemes()
    const aliases = listAliases()

    console.log("")
    console.log(`  Available themes (${themes.length}):`)
    console.log("")
    for (const name of themes) {
      const theme = resolveTheme(name)!
      const bg = theme.background ?? ""
      const fg = theme.foreground ?? ""
      console.log(`  ${name.padEnd(22)} ${bg} on ${fg}`)
    }
    if (aliases.length > 0) {
      console.log("")
      console.log("  Aliases:")
      console.log("")
      for (const [alias, canonical] of aliases) {
        console.log(`  ${alias.padEnd(22)} → ${canonical}`)
      }
    }
    console.log("")
    console.log("  Usage: termless play --theme dracula demo.tape")
    console.log('         Set Theme "dracula"  (in .tape files)')
    console.log("")
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
