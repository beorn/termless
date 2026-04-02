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
import type { AnimationFrame } from "../../../src/animation/types.ts"

/** Read all of stdin as a string. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString("utf-8")
}

/** Check if a path has an image extension. */
function isImagePath(path: string): boolean {
  return /\.(gif|svg|png|apng)$/i.test(path)
}

/**
 * Write animation frames to an image output file.
 * Detects format from extension and uses the appropriate encoder.
 */
async function writeImageOutput(path: string, frames: AnimationFrame[]): Promise<void> {
  if (frames.length === 0) {
    console.error(`Warning: no frames captured for ${path}`)
    return
  }

  const dir = dirname(resolve(path))
  mkdirSync(dir, { recursive: true })

  if (path.endsWith(".gif")) {
    const { createGif } = await import("../../../src/animation/gif.ts")
    const gif = await createGif(frames)
    writeFileSync(resolve(path), gif)
  } else if (path.endsWith(".apng") || (path.endsWith(".png") && frames.length > 1)) {
    const { createApng } = await import("../../../src/animation/apng.ts")
    const apng = await createApng(frames)
    writeFileSync(resolve(path), apng)
  } else if (path.endsWith(".svg") && frames.length > 1) {
    const { createAnimatedSvg } = await import("../../../src/animation/animated-svg.ts")
    const svg = createAnimatedSvg(frames)
    writeFileSync(resolve(path), svg, "utf-8")
  } else if (path.endsWith(".svg")) {
    // Single frame SVG — write directly
    writeFileSync(resolve(path), frames[frames.length - 1]!.svg, "utf-8")
  } else if (path.endsWith(".png")) {
    // Single frame PNG — rasterize the SVG
    const resvg = await import("@resvg/resvg-js")
    const renderer = new resvg.Resvg(frames[frames.length - 1]!.svg, {
      fitTo: { mode: "zoom" as const, value: 2 },
    })
    const rendered = renderer.render()
    writeFileSync(resolve(path), rendered.asPng())
  }

  console.error(`Saved: ${path}`)
}

// =============================================================================
// Asciicast playback
// =============================================================================

async function playCast(
  source: string,
  opts: { output?: string[]; backend?: string; cols?: number; rows?: number },
): Promise<void> {
  const { parseAsciicast, replayAsciicast } = await import("../../../src/asciicast/reader.ts")
  const { createTerminal } = await import("../../../src/terminal.ts")
  const { backend } = await import("../../../src/backends.ts")

  const recording = parseAsciicast(source)
  const cols = opts.cols || recording.header.width
  const rows = opts.rows || recording.header.height

  const b = await backend(opts.backend ?? "vterm")
  const term = createTerminal({ backend: b, cols, rows })

  const outputs = opts.output ?? []
  const wantImages = outputs.some(isImagePath)
  const frames: AnimationFrame[] = []
  let lastFrameText = ""
  let lastFrameTime = Date.now()

  console.error(`Playing asciicast (${recording.events.length} events, ${cols}x${rows})...`)

  // Replay with real-time delays, streaming output
  let lastText = ""
  await replayAsciicast(recording, term, {
    speed: 1,
    onEvent: () => {
      const text = term.getText()
      if (text !== lastText) {
        // Clear screen and redraw
        process.stdout.write(`\x1b[2J\x1b[H${text}`)
        lastText = text

        // Capture frame for image output
        if (wantImages) {
          const now = Date.now()
          if (text !== lastFrameText) {
            if (frames.length > 0) {
              frames[frames.length - 1]!.duration = now - lastFrameTime
            }
            frames.push({ svg: term.screenshotSvg(), duration: 100 })
            lastFrameText = text
            lastFrameTime = now
          }
        }
      }
    },
  })

  // Capture final frame
  if (wantImages && term.getText() !== lastFrameText) {
    frames.push({ svg: term.screenshotSvg(), duration: 100 })
  }

  // Write outputs
  if (outputs.length > 0) {
    for (const output of outputs) {
      if (isImagePath(output)) {
        await writeImageOutput(output, frames)
      }
    }
  } else {
    // Print final terminal state
    console.log(term.getText())
  }

  term.close()
}

// =============================================================================
// Action
// =============================================================================

async function playAction(
  file: string,
  opts: {
    output?: string[]
    backend?: string
    compare?: string
    cols?: number
    rows?: number
  },
): Promise<void> {
  // stdin support: read from stdin if file is "-"
  let source: string
  let fileName: string
  if (file === "-") {
    source = await readStdin()
    fileName = "stdin"
  } else {
    source = readFileSync(resolve(file), "utf-8")
    fileName = file
  }

  const outputs = opts.output ?? []
  const firstOutput = outputs[0]

  // Detect format by extension
  if (file.endsWith(".cast")) {
    await playCast(source, opts)
    return
  }

  const tape = parseTape(source)

  const backends = opts.backend ? opts.backend.split(",").map((b) => b.trim()) : undefined

  // Multi-backend comparison mode
  if (opts.compare && backends && backends.length > 1) {
    const mode = opts.compare as CompareMode
    console.error(`Comparing across ${backends.length} backends (${backends.join(", ")})...`)

    const result = await compareTape(tape, {
      backends,
      mode,
      output: firstOutput,
    })

    // Save composed SVG if output specified and composition was produced
    if (firstOutput && result.composedSvg) {
      writeFileSync(firstOutput, result.composedSvg, "utf-8")
      console.error(`Composed comparison saved: ${firstOutput}`)
    }

    // Save individual screenshots
    if (mode === "separate") {
      for (const s of result.screenshots) {
        const outputDir = firstOutput ? dirname(firstOutput) : "."
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
  const shell = tape.settings.Shell?.replace(/^"|"$/g, "") ?? undefined
  const wantImages = outputs.some(isImagePath)

  // If tape has a Shell setting, spawn a real PTY and type into it
  if (shell) {
    const { createTerminal } = await import("../../../src/terminal.ts")
    const { backend } = await import("../../../src/backends.ts")
    const cols = opts.cols || Number(tape.settings.Width) || 80
    const rows = opts.rows || Number(tape.settings.Height) || 24

    const b = await backend(backendName ?? "vterm")
    const term = createTerminal({ backend: b, cols, rows })
    await term.spawn([shell])

    // Collect animation frames for image output
    const frames: AnimationFrame[] = []
    let lastFrameText = ""
    let lastFrameTime = Date.now()

    const captureFrame = () => {
      if (!wantImages) return
      const text = term.getText()
      if (text !== lastFrameText) {
        const now = Date.now()
        if (frames.length > 0) {
          frames[frames.length - 1]!.duration = now - lastFrameTime
        }
        frames.push({ svg: term.screenshotSvg(), duration: 100 })
        lastFrameText = text
        lastFrameTime = now
      }
    }

    // Stream PTY output to stdout
    console.error(`Playing ${fileName} (shell: ${shell})...`)

    // Capture initial frame
    captureFrame()

    for (const cmd of tape.commands) {
      switch (cmd.type) {
        case "type":
          term.type(cmd.text)
          break
        case "key": {
          const keyMap: Record<string, string> = {
            enter: "\r",
            backspace: "\x7f",
            tab: "\t",
            space: " ",
            escape: "\x1b",
            delete: "\x1b[3~",
            up: "\x1b[A",
            down: "\x1b[B",
            right: "\x1b[C",
            left: "\x1b[D",
          }
          const count = cmd.count ?? 1
          const seq = keyMap[cmd.key.toLowerCase()] ?? (cmd.key.length === 1 ? cmd.key : "")
          for (let i = 0; i < count; i++) term.type(seq)
          break
        }
        case "ctrl":
          term.type(String.fromCharCode(cmd.key.toLowerCase().charCodeAt(0) - 0x60))
          break
        case "alt":
          term.type(`\x1b${cmd.key}`)
          break
        case "sleep":
          await new Promise((r) => setTimeout(r, cmd.ms))
          captureFrame()
          break
        case "screenshot": {
          captureFrame()
          // Write screenshot to first matching output or default
          for (const output of outputs) {
            if (!isImagePath(output)) {
              const { screenshotPng } = await import("../../../src/png.ts")
              const png = await screenshotPng(term)
              const outPath = cmd.path ?? output ?? "screenshot.png"
              mkdirSync(dirname(resolve(outPath)), { recursive: true })
              writeFileSync(resolve(outPath), png)
              console.error(`Screenshot saved: ${outPath}`)
              break
            }
          }
          break
        }
        case "set":
          // Handle resize
          if (cmd.key === "Width") term.resize(Number(cmd.value), term.rows)
          if (cmd.key === "Height") term.resize(term.cols, Number(cmd.value))
          break
      }
    }

    // Wait a moment for final output
    await new Promise((r) => setTimeout(r, 200))
    captureFrame()

    // Write outputs
    if (outputs.length > 0) {
      for (const output of outputs) {
        if (isImagePath(output)) {
          await writeImageOutput(output, frames)
        }
      }
    }

    // Print final terminal state
    console.log(term.getText())
    await term.close()
    return
  }

  // No shell — headless execution (for tapes without Set Shell)
  console.error(`Playing ${fileName}...`)

  // Collect animation frames for image output
  const frames: AnimationFrame[] = []

  const result = await executeTape(tape, {
    backend: backendName,
    cols: opts.cols,
    rows: opts.rows,
    onScreenshot: (png, path) => {
      const outPath = path ?? firstOutput ?? "screenshot.png"
      const dir = dirname(resolve(outPath))
      mkdirSync(dir, { recursive: true })
      writeFileSync(resolve(outPath), png)
      console.error(`Screenshot saved: ${outPath}`)
    },
  })

  // Capture final frame for image outputs
  if (wantImages) {
    const svg = result.terminal.screenshotSvg()
    frames.push({ svg, duration: 100 })
  }

  // Write image outputs
  for (const output of outputs) {
    if (isImagePath(output)) {
      await writeImageOutput(output, frames)
    }
  }

  // Print terminal text to stdout
  console.log(result.terminal.getText())

  console.error(`Done in ${result.duration}ms (${result.screenshotCount} screenshot(s))`)

  await result.terminal.close()
}

// =============================================================================
// Registration
// =============================================================================

export function registerPlayCommand(program: Command): void {
  program
    .command("play <file>")
    .description("Tape player — play back recordings (use - for stdin)")
    .option("-o, --output <path...>", "Output file(s), format by extension (repeat for multiple)")
    .option("-b, --backend <name>", "Backend(s), comma-separated (default: vterm)")
    .option("--compare <mode>", "Comparison mode: separate, side-by-side, grid, diff")
    .option("--cols <n>", "Terminal columns override", parseNum, 0)
    .option("--rows <n>", "Terminal rows override", parseNum, 0)
    .action(playAction)
}
