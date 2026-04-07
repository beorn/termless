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

import type { Command } from "@silvery/commander"

const parseNum = (v: string) => parseInt(v, 10)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { parseTape } from "../../../src/tape/parser.ts"
import { executeTape } from "../../../src/tape/executor.ts"
import { compareTape, type CompareMode } from "../../../src/tape/compare.ts"
import { overlayKeystroke } from "../../../src/tape/overlay.ts"
import { resolveTheme } from "../../../src/tape/themes.ts"
import type { AnimationFrame } from "../../../src/animation/types.ts"
import type { SvgScreenshotOptions, WindowBar } from "../../../src/types.ts"

/** Read all of stdin as a string. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString("utf-8")
}

/** Apply CLI visual polish options to SvgScreenshotOptions. */
function applyVisualOptions(
  svgOpts: SvgScreenshotOptions,
  cliOpts: {
    padding?: number
    borderRadius?: number
    windowBar?: string
    windowBarSize?: number
    margin?: number
    marginFill?: string
    framerate?: number
  },
): void {
  if (cliOpts.padding != null) svgOpts.padding = cliOpts.padding
  if (cliOpts.borderRadius != null) svgOpts.borderRadius = cliOpts.borderRadius
  if (cliOpts.windowBar != null) svgOpts.windowBar = cliOpts.windowBar.toLowerCase() as WindowBar
  if (cliOpts.windowBarSize != null) svgOpts.windowBarSize = cliOpts.windowBarSize
  if (cliOpts.margin != null) svgOpts.margin = cliOpts.margin
  if (cliOpts.marginFill != null) svgOpts.marginFill = cliOpts.marginFill
  if (cliOpts.framerate != null) svgOpts.framerate = cliOpts.framerate
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
    console.log(`  Warning: no frames captured for ${path}`)
    return
  }

  const ext = path.match(/\.\w+$/)?.[0] ?? ""
  console.log(`  Generating ${ext.slice(1).toUpperCase()} from ${frames.length} frames...`)

  const dir = dirname(resolve(path))
  mkdirSync(dir, { recursive: true })

  if (path.endsWith(".gif")) {
    const { createGif } = await import("../../../src/animation/gif.ts")
    const gif = await createGif(frames)
    writeFileSync(resolve(path), gif)
  } else if (path.endsWith(".apng")) {
    const { createApng } = await import("../../../src/animation/apng.ts")
    const apng = await createApng(frames)
    writeFileSync(resolve(path), apng)
  } else if (path.endsWith(".svg") && frames.length > 1) {
    const { createAnimatedSvg } = await import("../../../src/animation/animated-svg.ts")
    const svg = createAnimatedSvg(frames)
    writeFileSync(resolve(path), svg, "utf-8")
  } else if (path.endsWith(".svg")) {
    writeFileSync(resolve(path), frames[frames.length - 1]!.svg, "utf-8")
  } else if (path.endsWith(".png")) {
    const resvg = await import("@resvg/resvg-js")
    const renderer = new resvg.Resvg(frames[frames.length - 1]!.svg, {
      fitTo: { mode: "zoom" as const, value: 2 },
      font: { loadSystemFonts: true, defaultFontFamily: "Menlo" },
    })
    const rendered = renderer.render()
    writeFileSync(resolve(path), rendered.asPng())
  }

  const size = Bun.file(resolve(path)).size
  const sizeStr = size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)}MB` : `${(size / 1024).toFixed(0)}KB`
  console.log(`  Saved: ${path} (${sizeStr})`)
}

// =============================================================================
// Asciicast playback
// =============================================================================

async function playCast(
  source: string,
  opts: {
    output?: string[]
    backend?: string
    cols?: number
    rows?: number
    theme?: string
    padding?: number
    borderRadius?: number
    windowBar?: string
    windowBarSize?: number
    margin?: number
    marginFill?: string
    speed?: number
    framerate?: number
  },
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

  // Resolve theme for screenshot rendering
  const svgOpts: SvgScreenshotOptions = {}
  if (opts.theme) {
    const theme = resolveTheme(opts.theme)
    if (theme) svgOpts.theme = theme
  }
  applyVisualOptions(svgOpts, opts)

  console.log(`Playing asciicast (${recording.events.length} events, ${cols}x${rows})...`)

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
            frames.push({ svg: term.screenshotSvg(svgOpts), duration: 100 })
            lastFrameText = text
            lastFrameTime = now
          }
        }
      }
    },
  })

  // Capture final frame
  if (wantImages && term.getText() !== lastFrameText) {
    frames.push({ svg: term.screenshotSvg(svgOpts), duration: 100 })
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
    showKeys?: boolean
    theme?: string
    padding?: number
    borderRadius?: number
    windowBar?: string
    windowBarSize?: number
    margin?: number
    marginFill?: string
    speed?: number
    framerate?: number
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
    console.log(`Comparing across ${backends.length} backends (${backends.join(", ")})...`)

    const result = await compareTape(tape, {
      backends,
      mode,
      output: firstOutput,
    })

    // Save composed SVG if output specified and composition was produced
    if (firstOutput && result.composedSvg) {
      writeFileSync(firstOutput, result.composedSvg, "utf-8")
      console.log(`Composed comparison saved: ${firstOutput}`)
    }

    // Save individual screenshots
    if (mode === "separate") {
      for (const s of result.screenshots) {
        const outputDir = firstOutput ? dirname(firstOutput) : "."
        mkdirSync(outputDir, { recursive: true })
        const path = `${outputDir}/${s.backend}.png`
        writeFileSync(path, s.png)
        console.log(`Screenshot saved: ${path}`)
      }
    }

    console.log(`Text match: ${result.textMatch ? "yes" : "NO — output differs between backends"}`)
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

    // Resolve theme for screenshot rendering
    const shellSvgOpts: SvgScreenshotOptions = {}
    const shellThemeName = opts.theme ?? tape.settings.Theme
    if (shellThemeName) {
      const theme = resolveTheme(shellThemeName)
      if (theme) shellSvgOpts.theme = theme
    }
    // Apply tape settings for visual polish, then CLI overrides on top
    applyVisualOptions(shellSvgOpts, {
      padding: tape.settings.Padding ? parseInt(tape.settings.Padding, 10) : undefined,
      borderRadius: tape.settings.BorderRadius ? parseInt(tape.settings.BorderRadius, 10) : undefined,
      windowBar: tape.settings.WindowBar ?? undefined,
      windowBarSize: tape.settings.WindowBarSize ? parseInt(tape.settings.WindowBarSize, 10) : undefined,
      margin: tape.settings.Margin ? parseInt(tape.settings.Margin, 10) : undefined,
      marginFill: tape.settings.MarginFill ?? undefined,
      framerate: tape.settings.Framerate ? parseInt(tape.settings.Framerate, 10) : undefined,
    })
    // CLI flags override tape settings
    applyVisualOptions(shellSvgOpts, opts)

    // Playback speed
    const shellPlaybackSpeed =
      opts.speed ?? (tape.settings.PlaybackSpeed ? Number.parseFloat(tape.settings.PlaybackSpeed) : 1)

    // Collect animation frames for image output
    const frames: AnimationFrame[] = []
    let lastFrameText = ""
    let lastFrameTime = Date.now()
    let currentKeystroke = ""

    const captureFrame = () => {
      if (!wantImages) return
      const text = term.getText()
      if (text !== lastFrameText) {
        const now = Date.now()
        if (frames.length > 0) {
          frames[frames.length - 1]!.duration = now - lastFrameTime
        }
        let svg = term.screenshotSvg(shellSvgOpts)
        if (opts.showKeys && currentKeystroke) {
          svg = overlayKeystroke(svg, currentKeystroke)
        }
        frames.push({ svg, duration: 100 })
        lastFrameText = text
        lastFrameTime = now
      }
    }

    /** Format a tape command as a human-readable keystroke label. */
    const commandToKeystroke = (cmd: import("../../../src/tape/parser.ts").TapeCommand): string => {
      switch (cmd.type) {
        case "type": {
          const display = cmd.text.length > 20 ? `Type: ...${cmd.text.slice(-17)}` : `Type: ${cmd.text}`
          return display
        }
        case "key":
          return cmd.key
        case "ctrl":
          return `Ctrl+${cmd.key}`
        case "alt":
          return `Alt+${cmd.key}`
        default:
          return ""
      }
    }

    // Stream PTY output to stdout
    console.log(`Playing ${fileName} (shell: ${shell})...`)

    for (const cmd of tape.commands) {
      switch (cmd.type) {
        case "type":
          if (opts.showKeys) currentKeystroke = commandToKeystroke(cmd)
          term.type(cmd.text)
          break
        case "key": {
          if (opts.showKeys) currentKeystroke = commandToKeystroke(cmd)
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
          if (opts.showKeys) currentKeystroke = commandToKeystroke(cmd)
          term.type(String.fromCharCode(cmd.key.toLowerCase().charCodeAt(0) - 0x60))
          break
        case "alt":
          if (opts.showKeys) currentKeystroke = commandToKeystroke(cmd)
          term.type(`\x1b${cmd.key}`)
          break
        case "sleep":
          await new Promise((r) => setTimeout(r, cmd.ms / shellPlaybackSpeed))
          captureFrame()
          if (opts.showKeys) currentKeystroke = ""
          break
        case "screenshot": {
          captureFrame()
          // Write screenshot to first matching output or default
          for (const output of outputs) {
            if (!isImagePath(output)) {
              const { screenshotPng } = await import("../../../src/png.ts")
              const png = await screenshotPng(term, shellSvgOpts)
              const outPath = cmd.path ?? output ?? "screenshot.png"
              mkdirSync(dirname(resolve(outPath)), { recursive: true })
              writeFileSync(resolve(outPath), png)
              console.log(`Screenshot saved: ${outPath}`)
              break
            }
          }
          break
        }
        case "expect": {
          const timeout = cmd.timeout ?? 5000
          const pollInterval = 50
          const deadline = Date.now() + timeout
          let found = false
          while (Date.now() < deadline) {
            const text = term.getText()
            if (text.includes(cmd.text)) {
              found = true
              break
            }
            await new Promise((r) => setTimeout(r, pollInterval))
          }
          if (!found) {
            throw new Error(`Expect timed out after ${timeout}ms: text "${cmd.text}" not found`)
          }
          break
        }
        case "set":
          // Handle resize
          if (cmd.key === "Width") term.resize(Number(cmd.value), term.rows)
          if (cmd.key === "Height") term.resize(term.cols, Number(cmd.value))
          // Handle dynamic theme change (only if no --theme CLI override)
          if (cmd.key === "Theme" && !opts.theme) {
            const theme = resolveTheme(cmd.value)
            if (theme) shellSvgOpts.theme = theme
          }
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
  console.log(`Playing ${fileName}...`)

  // Resolve theme for frame screenshots (onAfterCommand uses screenshotSvg directly)
  const headlessSvgOpts: SvgScreenshotOptions = {}
  const headlessThemeName = opts.theme ?? tape.settings.Theme
  if (headlessThemeName) {
    const theme = resolveTheme(headlessThemeName)
    if (theme) headlessSvgOpts.theme = theme
  }
  // Apply tape settings for visual polish, then CLI overrides on top
  applyVisualOptions(headlessSvgOpts, {
    padding: tape.settings.Padding ? parseInt(tape.settings.Padding, 10) : undefined,
    borderRadius: tape.settings.BorderRadius ? parseInt(tape.settings.BorderRadius, 10) : undefined,
    windowBar: tape.settings.WindowBar ?? undefined,
    windowBarSize: tape.settings.WindowBarSize ? parseInt(tape.settings.WindowBarSize, 10) : undefined,
    margin: tape.settings.Margin ? parseInt(tape.settings.Margin, 10) : undefined,
    marginFill: tape.settings.MarginFill ?? undefined,
    framerate: tape.settings.Framerate ? parseInt(tape.settings.Framerate, 10) : undefined,
  })
  // CLI flags override tape settings
  applyVisualOptions(headlessSvgOpts, opts)

  // Collect animation frames for image output
  const frames: AnimationFrame[] = []
  let lastStreamedText = ""

  const result = await executeTape(tape, {
    backend: backendName,
    cols: opts.cols || undefined,
    rows: opts.rows || undefined,
    theme: opts.theme,
    onScreenshot: (png, path) => {
      const outPath = path ?? firstOutput ?? "screenshot.png"
      const dir = dirname(resolve(outPath))
      mkdirSync(dir, { recursive: true })
      writeFileSync(resolve(outPath), png)
      console.log(`Screenshot saved: ${outPath}`)
    },
    onAfterCommand: (cmd, terminal) => {
      // Real-time streaming: print terminal state after each command
      const text = terminal.getText()
      if (text !== lastStreamedText) {
        process.stdout.write(`\x1b[2J\x1b[H${text}`)
        lastStreamedText = text
      }

      // Capture frames with optional keystroke overlay
      if (wantImages) {
        let svg = terminal.screenshotSvg(headlessSvgOpts)
        if (opts.showKeys) {
          let label = ""
          switch (cmd.type) {
            case "type":
              label = cmd.text.length > 20 ? `Type: ...${cmd.text.slice(-17)}` : `Type: ${cmd.text}`
              break
            case "key":
              label = cmd.key
              break
            case "ctrl":
              label = `Ctrl+${cmd.key}`
              break
            case "alt":
              label = `Alt+${cmd.key}`
              break
          }
          if (label) {
            svg = overlayKeystroke(svg, label)
          }
        }
        frames.push({ svg, duration: 100 })
      }
    },
  })

  // Capture final frame for image outputs (if no frames captured yet)
  if (wantImages && frames.length === 0) {
    const svg = result.terminal.screenshotSvg(headlessSvgOpts)
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

  console.log(`Done in ${result.duration}ms (${result.screenshotCount} screenshot(s))`)

  await result.terminal.close()
}

// =============================================================================
// Registration
// =============================================================================

export function registerPlayCommand(program: Command): void {
  const cmd = program
    .command("play")
    .argument("[file]", "Recording file to play (use - for stdin)")
    .description("Tape player — play back recordings (use - for stdin)")
    .option("-o, --output <path...>", "Output file(s), format by extension (repeat for multiple)")
    .option("-b, --backend <name>", "Backend(s), comma-separated (default: vterm)")
    .option("--compare <mode>", "Comparison mode: separate, side-by-side, grid, diff")
    .option("--cols <n>", "Terminal columns override", parseNum, 0)
    .option("--rows <n>", "Terminal rows override", parseNum, 0)
    .option("--show-keys", "Overlay keystroke badges on frames")
    .option("--theme <name>", "Color theme for screenshots (e.g. dracula, nord, monokai)")
    .option("--padding <n>", "Padding between content and SVG edge in px", parseNum)
    .option("--border-radius <n>", "Border radius for the SVG in px", parseNum)
    .option("--window-bar <style>", "Window bar style: none, rings, colorful")
    .option("--window-bar-size <n>", "Window bar height in px (default: 40)", parseNum)
    .option("--margin <n>", "Outer margin in px", parseNum)
    .option("--margin-fill <color>", "Outer margin fill color (e.g. #1a1a2e)")
    .option("--speed <n>", "Playback speed multiplier (e.g. 2 for 2x)", Number.parseFloat)
    .option("--framerate <n>", "Output framerate in FPS", parseNum)

  cmd.addHelpSection("Examples:", [
    ["$ termless play demo.tape", "Play a .tape file (shows output in terminal)"],
    ["$ termless play demo.cast", "Play an asciicast recording"],
    ["$ termless play -o demo.gif demo.tape", "Convert tape to animated GIF"],
    ["$ termless play -o demo.svg demo.tape", "Convert to animated SVG"],
    ["$ termless play -b vterm,ghostty demo.tape", "Cross-terminal comparison"],
    ["$ cat demo.tape | termless play -", "Play from stdin"],
  ])

  cmd.actionMerged(async (opts: { file?: string } & Record<string, any>) => {
    if (!opts.file) {
      cmd.outputHelp()
      return
    }
    const { file, ...rest } = opts
    await playAction(file, rest)
  })
}
