/**
 * `termless view` — present a recorded terminal session.
 *
 * `view` is the first-class **view** verb of the recording domain (record ·
 * **view** · play · compare). It takes a recording on disk — a single `.rec`
 * file or a bare frame-trace directory — and presents it:
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
 * termless view ./mysession.rec
 *
 * # Animate a recording to a GIF
 * termless view ./mysession.rec --format gif -o demo.gif
 * ```
 */

import type { Command } from "@silvery/commander"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"

/** Parsed options for the `view` verb. */
export interface ViewCliOpts {
  /** Path to the recording — a `.rec` file or a frame-trace directory. */
  recording: string
  /** Output file path — required for `--format`. */
  output?: string
  /** Animation format — `gif` only; omitted means scrub mode. */
  format?: string
}

/**
 * Resolve a recording path to a directory working form.
 *
 * A single `.rec` file is a ZIP container — it is unpacked to a fresh temp
 * directory so the directory-oriented presentation code (`writeViewer`,
 * `recordingToPngFrames`) can read its PNGs. A directory (a `.rec` directory
 * bundle or a bare frame-trace directory) is used as-is.
 *
 * Returns the directory plus a `cleanup` callback — a no-op for a real
 * directory, an `rm -rf` for an unpacked temp directory.
 */
async function resolveRecordingDir(path: string): Promise<{ dir: string; cleanup: () => void }> {
  const abs = resolve(path)
  if (existsSync(abs) && statSync(abs).isFile()) {
    const { unpackRecording } = await import("../../../src/recording/native/native-rec.ts")
    const tmp = mkdtempSync(join(tmpdir(), "termless-rec-"))
    unpackRecording(abs, tmp)
    return { dir: tmp, cleanup: () => rmSync(tmp, { recursive: true, force: true }) }
  }
  return { dir: abs, cleanup: () => {} }
}

/**
 * Execute the `view` verb: scrub mode (default — writes `viewer.html`) or
 * animate mode (`--format gif` — writes a GIF to `--output`).
 *
 * Exported for unit testing.
 */
export async function viewAction(opts: ViewCliOpts): Promise<void> {
  const { dir, cleanup } = await resolveRecordingDir(opts.recording)
  try {
    // ── Animate mode: --format gif ──
    if (opts.format) {
      const format = opts.format.toLowerCase()
      if (format !== "gif") {
        console.error(`Error: --format only supports "gif". A recording stores rasterized PNGs;`)
        console.error(`       GIF is the only animation encoding derivable without re-rendering.`)
        process.exitCode = 1
        return
      }
      if (!opts.output) {
        console.error("Error: --format gif needs an output path. Pass -o <file>.gif.")
        process.exitCode = 1
        return
      }

      const { readRecording } = await import("../../../src/recording/native/native-rec.ts")
      const { recordingToPngFrames } = await import("../../../src/view/from-recording.ts")
      const { createGifFromPngs } = await import("../../../src/view/gif.ts")

      const recording = readRecording(dir)
      // A `.rec` bundle holds its PNGs under `frames/`; a bare frame-trace
      // directory holds them in the directory root.
      const nested = join(dir, "frames")
      const framesDir = existsSync(nested) && statSync(nested).isDirectory() ? nested : dir
      const frames = recordingToPngFrames(recording, framesDir)
      const gif = await createGifFromPngs(frames)

      const out = resolve(opts.output)
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, gif)
      console.log(`Saved: ${opts.output} (${frames.length} frames)`)
      return
    }

    // ── Scrub mode (default): self-contained HTML viewer ──
    const { writeViewer } = await import("../../../src/view/viewer.ts")
    // A `.rec` bundle keeps `index.jsonl` + PNGs under `frames/`; a bare
    // frame-trace directory keeps them in the directory root.
    const nested = join(dir, "frames")
    const viewerDir = existsSync(join(nested, "index.jsonl")) ? nested : dir
    const result = writeViewer(viewerDir)
    let viewerFile = result.viewerFile
    // When the source was a single `.rec` file, the viewer was written into a
    // temp directory — copy it next to the original `.rec`.
    const srcAbs = resolve(opts.recording)
    if (existsSync(srcAbs) && statSync(srcAbs).isFile()) {
      const dest = join(dirname(srcAbs), basename(srcAbs).replace(/\.rec$/i, "") + ".viewer.html")
      copyFileSync(result.viewerFile, dest)
      viewerFile = dest
    }
    console.log(`Viewer: ${viewerFile}`)
    console.log(`  ${result.frameCount} frames, ${result.imageCount} images, ${(result.bytes / 1024).toFixed(0)} KB`)
    console.log(`  Open it in a browser — no server needed.`)
  } finally {
    cleanup()
  }
}

export function registerViewCommand(program: Command): void {
  const cmd = program
    .command("view")
    .description("Present a recording — scrub it in the browser or animate it")
    .argument("<recording>", "Recording — a .rec file or a frame-trace directory")
    .option("-o, --output <path>", "Output file for --format")
    .option("--format <type>", "Animate the recording to a file: gif")

  cmd.addHelpSection("Examples:", [
    ["$ termless view ./mysession.rec", "Write a scrubbable viewer.html"],
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
