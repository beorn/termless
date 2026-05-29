/**
 * `termless compare` — diff a recording across N backends.
 *
 * `compare` is the first-class **compare** verb of the recording domain
 * (record · view · play · **compare**). It re-executes one recording against
 * two or more terminal backends and diffs the results — either as side-by-side
 * panels, a parser-divergence overlay (canvas pipeline), or a legacy SVG grid.
 *
 * `compare` is the operation; the inputs are a recording plus a backend set.
 * It shares its execution core with `play` — `play --compare` is a thin alias
 * that delegates here.
 *
 * @example
 * ```bash
 * # Side-by-side panels across two backends
 * termless compare demo.tape -b ghostty,xtermjs -o panels.png
 *
 * # Parser-divergence overlay
 * termless compare demo.tape -b ghostty,xtermjs --mode diff -o diff.png
 * ```
 */

import type { Command } from "@silvery/commander"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { backend as resolveBackend } from "../../../src/backend/backends.ts"
import { compareCanvas, type CanvasBackendSpec } from "../../../src/recording/tape/compare-canvas.ts"
import { type CompareMode, compareTape } from "../../../src/recording/tape/compare.ts"
import { parseTape } from "../../../src/recording/tape/parser.ts"
import { compareSeparateOutputDir, resolveBackendNames, writeComparisonOutput } from "./play-cmd.ts"

const parseNum = (v: string) => parseInt(v, 10)

/** Read all of stdin as a string. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString("utf-8")
}

/** Options for the `compare` verb. */
export interface CompareCliOpts {
  /** Backend names, comma-separated (at least two). */
  backend?: string
  /** Comparison mode: side-by-side, diff, separate, grid. */
  mode?: string
  /** Output file path. */
  output?: string
  /** Terminal columns override. */
  cols?: number
  /** Terminal rows override. */
  rows?: number
}

/**
 * Execute the `compare` verb: re-execute a recording across N backends and
 * diff the results. Exported so `play --compare` can delegate here.
 *
 * @param file Recording file to compare (`-` for stdin).
 * @param opts Compare options — backends, mode, output, dimensions.
 */
export async function compareAction(file: string, opts: CompareCliOpts): Promise<void> {
  const source = file === "-" ? await readStdin() : readFileSync(resolve(file), "utf-8")
  const tape = parseTape(source)

  const backends = resolveBackendNames(opts.backend)
  if (!backends || backends.length < 2) {
    throw new Error("compare needs at least 2 backends — pass -b <name1>,<name2>")
  }

  const mode = (opts.mode ?? "side-by-side") as CompareMode
  const firstOutput = opts.output

  // ── Canvas-pipeline compare (side-by-side / diff) ──────────────
  // One renderer (ghostty-web canvas), N parsers — isolates parser divergence:
  // any pixel difference is attributable to a backend's VT parser, not to a
  // rendering-engine difference.
  if (mode === "side-by-side" || mode === "diff") {
    const usable: CanvasBackendSpec[] = []
    for (const name of backends) {
      try {
        usable.push({ name, backend: await resolveBackend(name) })
      } catch {
        console.log(`  Warning: backend "${name}" is not installed/built — skipping`)
      }
    }
    if (usable.length < 2) {
      throw new Error(
        `compare --mode ${mode} needs at least 2 installed backends; usable: ${
          usable.map((spec) => (typeof spec === "string" ? spec : spec.name)).join(", ") || "(none)"
        }`,
      )
    }

    console.log(
      `Canvas-comparing across ${usable.length} backends (${usable.map((spec) => (typeof spec === "string" ? spec : spec.name)).join(", ")})...`,
    )

    const wantsGif = (firstOutput ?? "").toLowerCase().endsWith(".gif")
    const canvasResult = await compareCanvas(tape, {
      backends: usable,
      mode,
      ...(opts.cols ? { cols: opts.cols } : {}),
      ...(opts.rows ? { rows: opts.rows } : {}),
      animate: wantsGif,
    })

    if (mode === "diff" && canvasResult.divergentPixels != null) {
      const pct = canvasResult.totalPixels
        ? ((canvasResult.divergentPixels / canvasResult.totalPixels) * 100).toFixed(3)
        : "0"
      console.log(`Divergent pixels: ${canvasResult.divergentPixels}/${canvasResult.totalPixels} (${pct}%)`)
    }

    if (firstOutput) {
      const resolved = resolve(firstOutput)
      mkdirSync(dirname(resolved), { recursive: true })
      if (wantsGif && canvasResult.composedFrames && canvasResult.composedFrames.length > 0) {
        const { createGifFromPngs } = await import("../../../src/view/gif.ts")
        const gif = await createGifFromPngs(canvasResult.composedFrames.map((png) => ({ png, duration: 600 })))
        writeFileSync(resolved, gif)
        console.log(`Stitched GIF saved: ${firstOutput} (${canvasResult.composedFrames.length} frames)`)
      } else if (canvasResult.composedPng) {
        writeFileSync(resolved, canvasResult.composedPng)
        console.log(`Composed comparison saved: ${firstOutput}`)
      }
    } else {
      console.log("  (no -o output path; pass -o <file>.png or <file>.gif to save)")
    }

    console.log(`Text match: ${canvasResult.textMatch ? "yes" : "NO — output differs between backends"}`)
    return
  }

  // ── Legacy SVG-composition compare (separate / grid) ───────────
  console.log(`Comparing across ${backends.length} backends (${backends.join(", ")})...`)

  const result = await compareTape(tape, { backends, mode, output: firstOutput })

  if (firstOutput && result.composedSvg) {
    await writeComparisonOutput(firstOutput, result.composedSvg)
    console.log(`Composed comparison saved: ${firstOutput}`)
  }

  if (mode === "separate") {
    for (const s of result.screenshots) {
      const outputDir = compareSeparateOutputDir(firstOutput)
      mkdirSync(outputDir, { recursive: true })
      const path = `${outputDir}/${s.backend}.png`
      writeFileSync(path, s.png)
      console.log(`Screenshot saved: ${path}`)
    }
  }

  console.log(`Text match: ${result.textMatch ? "yes" : "NO — output differs between backends"}`)
}

export function registerCompareCommand(program: Command): void {
  const cmd = program
    .command("compare")
    .description("Diff a recording across two or more backends (use - for stdin)")
    .argument("[file]", "Recording file to compare (use - for stdin)")
    .option("-b, --backend <name>", "Backends, comma-separated (at least two)")
    .option(
      "--mode <mode>",
      "Comparison mode: side-by-side, diff (canvas pipeline), separate, grid (legacy SVG)",
      "side-by-side",
    )
    .option("-o, --output <path>", "Output file, format by extension (.png / .gif / .svg)")
    .option("--cols <n>", "Terminal columns override", parseNum, 0)
    .option("--rows <n>", "Terminal rows override", parseNum, 0)

  cmd.addHelpSection("Examples:", [
    ["$ termless compare demo.tape -b ghostty,xtermjs -o c.png", "Side-by-side panels"],
    ["$ termless compare demo.tape -b ghostty,xtermjs --mode diff -o d.png", "Parser-divergence overlay"],
    ["$ termless compare demo.tape -b vterm,vt100 --mode grid -o g.svg", "Legacy SVG grid"],
    ["$ cat demo.tape | termless compare - -b ghostty,xtermjs -o c.png", "Compare from stdin"],
  ])

  cmd.actionMerged(async (opts: { file?: string } & Record<string, unknown>) => {
    if (!opts.file) {
      cmd.outputHelp()
      return
    }
    await compareAction(opts.file, {
      backend: opts.backend as string | undefined,
      mode: opts.mode as string | undefined,
      output: opts.output as string | undefined,
      cols: (opts.cols as number) || undefined,
      rows: (opts.rows as number) || undefined,
    })
  })
}
