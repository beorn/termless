/**
 * `termless view` — present a recorded terminal session.
 *
 * `view` is the first-class **view** verb of the recording domain (record ·
 * **view** · play · compare). It takes a recording on disk — a sealed `.ttyz`
 * archive or a `.tty` bundle directory — and presents it:
 *
 * - default (`--scrub`): writes a self-contained scrubbable `viewer.html`
 *   alongside the recording (timeline scrub, find, filter, pixel-diff,
 *   per-frame metadata) and prints its path.
 * - `--format gif`: encodes the recording's frames projection as an animated
 *   GIF written to `-o <path>`.
 *
 * There is no separate "export" verb — writing a GIF is just `view` with an
 * animation format and a file sink.
 *
 * @example
 * ```bash
 * # Scrub a recording in the browser (writes viewer.html next to it)
 * termless view ./mysession.ttyz
 *
 * # Animate a recording to a GIF
 * termless view ./mysession.ttyz --format gif -o demo.gif
 * ```
 */

import type { Command } from "@silvery/commander"
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { openRecordingBundle } from "./recording-bundle.ts"

/** Parsed options for the `view` verb. */
export interface ViewCliOpts {
  /** Path to the recording — a sealed `.ttyz` archive or a `.tty` bundle directory. */
  recording: string
  /** Output file path — required for `--format`. */
  output?: string
  /** Animation format — `gif` only; omitted means scrub mode. */
  format?: string
}

/**
 * Execute the `view` verb: scrub mode (default — writes `viewer.html`) or
 * animate mode (`--format gif` — writes a GIF to `--output`).
 *
 * Exported for unit testing.
 */
export async function viewAction(opts: ViewCliOpts): Promise<void> {
  const format = opts.format?.toLowerCase()
  const output = opts.output
  if (format && format !== "gif") {
    console.error(`Error: --format only supports "gif". A recording stores rasterized PNGs;`)
    console.error(`       GIF is the only animation encoding derivable without re-rendering.`)
    process.exitCode = 1
    return
  }
  if (format && !output) {
    console.error("Error: --format gif needs an output path. Pass -o <file>.gif.")
    process.exitCode = 1
    return
  }

  using bundle = openRecordingBundle(opts.recording)
  // ── Animate mode: --format gif ──
  if (format) {
    if (output === undefined) throw new Error("viewAction: validated GIF output path is missing")
    const { recordingToPngFrames } = await import("../../../src/view/from-recording.ts")
    const { createGifFromPngs } = await import("../../../src/view/gif.ts")

    const frames = recordingToPngFrames(bundle.recording, bundle.framesDir)
    const gif = await createGifFromPngs(frames)

    const out = resolve(output)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, gif)
    console.log(`Saved: ${output} (${frames.length} frames)`)
    return
  }

  // ── Scrub mode (default): self-contained HTML viewer ──
  const { writeViewer } = await import("../../../src/view/viewer.ts")
  const result = writeViewer(bundle.framesDir)
  let viewerFile = result.viewerFile
  // When the source was a sealed `.ttyz`, the viewer was written into a
  // temp directory — copy it next to the original archive.
  const srcAbs = resolve(opts.recording)
  if (existsSync(srcAbs) && statSync(srcAbs).isFile()) {
    const dest = join(dirname(srcAbs), basename(srcAbs).replace(/\.ttyz$/i, "") + ".viewer.html")
    copyFileSync(result.viewerFile, dest)
    viewerFile = dest
  }
  console.log(`Viewer: ${viewerFile}`)
  console.log(`  ${result.frameCount} frames, ${result.imageCount} images, ${(result.bytes / 1024).toFixed(0)} KB`)
  console.log(`  Open it in a browser — no server needed.`)
}

export function registerViewCommand(program: Command): void {
  const cmd = program
    .command("view")
    .description("Present a recording — scrub it in the browser or animate it")
    .argument("<recording>", "Recording — a .ttyz archive or a .tty bundle directory")
    .option("-o, --output <path>", "Output file for --format")
    .option("--format <type>", "Animate the recording to a file: gif")

  cmd.addHelpSection("Examples:", [
    ["$ termless view ./mysession.ttyz", "Write a scrubbable viewer.html"],
    ["$ termless view ./trace --format gif -o demo.gif", "Animate the recording to a GIF"],
  ])

  cmd.actionMerged(async (opts: { recording?: string } & Record<string, unknown>) => {
    if (!opts.recording) {
      cmd.outputHelp()
      return
    }
    await viewAction({
      recording: opts.recording,
      output: opts.output as string | undefined,
      format: opts.format as string | undefined,
    })
  })
}
