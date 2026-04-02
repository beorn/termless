/**
 * `termless play` — tape player for terminal recordings.
 *
 * Replaces the old `tape play` subcommand. Plays .tape files against
 * one or more backends, producing screenshots or cross-backend comparisons.
 *
 * @example
 * ```bash
 * # Play a tape file
 * termless play demo.tape -o demo.png
 *
 * # Multi-backend comparison
 * termless play -b vterm,ghostty --compare side-by-side demo.tape
 * ```
 */

import type { Command } from "commander"

const parseNum = (v: string) => parseInt(v, 10)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { parseTape } from "../../../src/tape/parser.ts"
import { executeTape } from "../../../src/tape/executor.ts"
import { compareTape, type CompareMode } from "../../../src/tape/compare.ts"

// =============================================================================
// Action
// =============================================================================

async function playAction(
  file: string,
  opts: {
    output?: string
    backend?: string
    compare?: string
    cols?: number
    rows?: number
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
    cols: opts.cols,
    rows: opts.rows,
    onScreenshot: (png, path) => {
      const outPath = path ?? opts.output ?? "screenshot.png"
      const dir = dirname(resolve(outPath))
      mkdirSync(dir, { recursive: true })
      writeFileSync(resolve(outPath), png)
      console.error(`Screenshot saved: ${outPath}`)
    },
  })

  // If no output file and no compare, print terminal text
  if (!opts.output && !opts.compare) {
    console.log(result.terminal.getText())
  }

  console.error(`Done in ${result.duration}ms (${result.screenshotCount} screenshot(s))`)

  await result.terminal.close()
}

// =============================================================================
// Registration
// =============================================================================

export function registerPlayCommand(program: Command): void {
  program
    .command("play <file>")
    .description("Tape player — play back recordings")
    .option("-o, --output <path>", "Output file, format by extension")
    .option("-b, --backend <name>", "Backend(s), comma-separated (default: vterm)")
    .option("--compare <mode>", "Comparison mode: separate, side-by-side, grid, diff")
    .option("--cols <n>", "Terminal columns override", parseNum, 0)
    .option("--rows <n>", "Terminal rows override", parseNum, 0)
    .action(playAction)
}
