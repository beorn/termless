/**
 * `termless tape` — play and record VHS .tape files.
 *
 * Plays .tape files against one or more terminal backends, producing
 * screenshots, recordings, or cross-backend comparisons.
 *
 * @example
 * ```bash
 * # Play a tape file
 * termless tape play demo.tape -o demo.png
 *
 * # Play against multiple backends and compare
 * termless tape play demo.tape --backend xtermjs,vterm --compare side-by-side
 *
 * # Record a new tape file (interactive)
 * termless tape record -o session.tape
 * ```
 */

import type { Command } from "commander"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { parseTape } from "../../../src/tape/parser.ts"
import { executeTape } from "../../../src/tape/executor.ts"
import { compareTape, type CompareMode } from "../../../src/tape/compare.ts"

// =============================================================================
// Play subcommand
// =============================================================================

async function playAction(
  file: string,
  opts: {
    output?: string
    backend?: string
    compare?: string
  },
): Promise<void> {
  const source = readFileSync(resolve(file), "utf-8")
  const tape = parseTape(source)

  const backends = opts.backend ? opts.backend.split(",").map((b) => b.trim()) : undefined

  // Multi-backend comparison mode
  if (opts.compare && backends && backends.length > 1) {
    const mode = opts.compare as CompareMode
    console.error(`Comparing across ${backends.length} backends (${backends.join(", ")})...`)

    const result = await compareTape(tape, {
      backends,
      mode,
      output: opts.output,
    })

    // Save composed SVG if output specified and composition was produced
    if (opts.output && result.composedSvg) {
      writeFileSync(opts.output, result.composedSvg, "utf-8")
      console.error(`Composed comparison saved: ${opts.output}`)
    }

    // Save individual screenshots
    if (mode === "separate") {
      for (const s of result.screenshots) {
        const outputDir = opts.output ? dirname(opts.output) : "."
        mkdirSync(outputDir, { recursive: true })
        const path = `${outputDir}/${s.backend}.png`
        writeFileSync(path, s.png)
        console.error(`Screenshot saved: ${path}`)
      }
    }

    console.error(`Text match: ${result.textMatch ? "yes" : "NO — output differs between backends"}`)
    return
  }

  // Single backend mode
  const backendName = backends?.[0]

  console.error(`Playing ${file}...`)

  const result = await executeTape(tape, {
    backend: backendName,
    onScreenshot: (png, path) => {
      const outPath = path ?? opts.output ?? "screenshot.png"
      const dir = dirname(resolve(outPath))
      mkdirSync(dir, { recursive: true })
      writeFileSync(resolve(outPath), png)
      console.error(`Screenshot saved: ${outPath}`)
    },
  })

  console.error(`Done in ${result.duration}ms (${result.screenshotCount} screenshot(s))`)

  await result.terminal.close()
}

// =============================================================================
// Record subcommand (stub — interactive recording)
// =============================================================================

async function recordAction(opts: { output?: string }): Promise<void> {
  const outputPath = opts.output ?? "recording.tape"

  // Interactive recording is complex — requires raw terminal input capture.
  // For now, print a helpful message about the format.
  console.error("Interactive tape recording is not yet implemented.")
  console.error(`\nTo create a tape file manually, write commands to ${outputPath}:`)
  console.error("")
  console.error("  # Example .tape file")
  console.error('  Set Shell "bash"')
  console.error('  Type "echo hello world"')
  console.error("  Enter")
  console.error("  Sleep 1s")
  console.error("  Screenshot")
  console.error("")
  console.error("See https://github.com/charmbracelet/vhs for the full format reference.")
  process.exit(1)
}

// =============================================================================
// Command registration
// =============================================================================

export function registerTapeCommand(program: Command): void {
  const tape = program.command("tape").description("Play and record VHS .tape files")

  tape
    .command("play <file>")
    .description("Play a .tape file against a terminal backend")
    .option("-o, --output <path>", "Output path for screenshots")
    .option("--backend <name>", "Backend name(s), comma-separated (default: vterm)")
    .option("--compare <mode>", "Comparison mode: separate, side-by-side, grid, diff")
    .action(playAction)

  tape
    .command("record")
    .description("Record a new .tape file (interactive)")
    .option("-o, --output <file>", "Output .tape file path")
    .action(recordAction)
}
