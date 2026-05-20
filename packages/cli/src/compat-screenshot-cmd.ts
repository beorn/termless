/**
 * `termless compat-screenshot` — capture a TUI in a real desktop terminal app.
 *
 * Spawns the user's actual macOS terminal (Ghostty / kitty / iTerm /
 * Terminal.app), runs a command, screenshots the window, cleans up.
 * Pixel-perfect for that terminal + the user's font/theme — the compat path.
 *
 * For routine visual iteration use `termless record` / `termless play`
 * (canvas renderer) instead — this path is slow, macOS-only, and pops a
 * real window.
 *
 * @example
 * ```bash
 * termless compat-screenshot --terminal ghostty --cols 140 --rows 40 \
 *   --wait-for ms -o /tmp/compat.png -- bun km view ~/Vault
 * ```
 */

import type { Command } from "@silvery/commander"

const parseNum = (v: string) => parseInt(v, 10)

interface CompatScreenshotCliOpts {
  command: string[]
  terminal?: string
  output?: string
  cols?: number
  rows?: number
  cwd?: string
  waitFor?: string
  waitTimeout?: number
  keep?: boolean
}

const VALID_TERMINALS = ["ghostty", "kitty", "iterm", "terminal"] as const

async function compatScreenshotAction(opts: CompatScreenshotCliOpts): Promise<void> {
  if (!opts.command || opts.command.length === 0) {
    console.error("Error: no command given. Pass the TUI command after `--`.")
    console.error("  termless compat-screenshot --terminal ghostty -- bun km view ~/Vault")
    process.exitCode = 1
    return
  }

  if (opts.terminal && !(VALID_TERMINALS as readonly string[]).includes(opts.terminal)) {
    console.error(`Error: unknown --terminal "${opts.terminal}". Valid: ${VALID_TERMINALS.join(", ")}.`)
    process.exitCode = 1
    return
  }

  const { compatScreenshot } = await import("@termless/peekaboo")

  try {
    const result = await compatScreenshot({
      cmd: opts.command.join(" "),
      terminal: opts.terminal as (typeof VALID_TERMINALS)[number] | undefined,
      outputPath: opts.output,
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      waitFor: opts.waitFor,
      waitTimeoutMs: opts.waitTimeout,
      keep: opts.keep,
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

export function registerCompatScreenshotCommand(program: Command): void {
  const cmd = program
    .command("compat-screenshot")
    .description("Capture a TUI in a real desktop terminal app (macOS — the compat path)")
    .argument("[command...]", "TUI command to run (after `--`)")
    .option("-t, --terminal <name>", "Terminal app: ghostty, kitty, iterm, terminal (auto-detect if omitted)")
    .option("-o, --output <path>", "Output PNG path (temp file if omitted)")
    .option("--cols <n>", "Requested terminal columns (default: 120)", parseNum)
    .option("--rows <n>", "Requested terminal rows (default: 40)", parseNum)
    .option("--cwd <path>", "Working directory for the command")
    .option("--wait-for <text>", "Text to wait for before screenshotting (default: any text)")
    .option("--wait-timeout <ms>", "First-paint wait timeout in ms (default: 10000)", parseNum)
    .option("--keep", "Keep the spawned terminal window open after capture")

  cmd.addHelpSection("Examples:", [
    ["$ termless compat-screenshot -- bun km view ~/Vault", "Auto-detect terminal, capture"],
    ["$ termless compat-screenshot -t ghostty --cols 140 --rows 40 -o c.png -- bun km view ~/V", "Explicit + sized"],
    ["$ termless compat-screenshot --wait-for ready -- bun km", "Wait for text 'ready' before capture"],
    ["$ termless compat-screenshot --keep -- bun km", "Leave the window open after the shot"],
  ])

  cmd.addHelpSection("Notes:", [
    ["macOS-only", "Needs a GUI session + Screen Recording permission"],
    ["For routine iteration", "Use `termless record` / `mcp__tty__screenshot` (canvas renderer) instead"],
  ])

  cmd.actionMerged(async (opts: { command?: string[] } & Record<string, unknown>) => {
    await compatScreenshotAction({
      command: opts.command ?? [],
      terminal: opts.terminal as string | undefined,
      output: opts.output as string | undefined,
      cols: opts.cols as number | undefined,
      rows: opts.rows as number | undefined,
      cwd: opts.cwd as string | undefined,
      waitFor: opts.waitFor as string | undefined,
      waitTimeout: opts.waitTimeout as number | undefined,
      keep: opts.keep as boolean | undefined,
    })
  })
}
