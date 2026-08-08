/**
 * `termless inspect` — summarize a tape bundle and its frame trace sidecar.
 */

import type { Command } from "@silvery/commander"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, dirname, extname, join, resolve } from "node:path"
import { parseTape } from "../../../src/recording/tape/parser.ts"
import { openRecordingBundle } from "./recording-bundle.ts"

export interface FrameTraceInspection {
  dir: string
  frameCount: number
  uniqueCount: number
  duplicateRatio: number
  durationMs: number
  files: string[]
}

export interface BundleInspection {
  tapePath: string
  backend: string
  commandCount: number
  frameDebounceMs: number | null
  frameTrace: FrameTraceInspection | null
}

function siblingFramesDir(tapePath: string): string {
  const ext = extname(tapePath)
  const base = ext.length > 0 ? basename(tapePath, ext) : basename(tapePath)
  return join(dirname(tapePath), `${base}.frames`)
}

function resolveFramesDir(tapePath: string, framesSetting: string | undefined): string {
  if (!framesSetting) return siblingFramesDir(tapePath)
  return resolve(dirname(tapePath), framesSetting)
}

function inspectFrameTrace(dir: string): FrameTraceInspection | null {
  if (!existsSync(dir)) return null

  using bundle = openRecordingBundle(dir)
  const frames = bundle.recording.frames ?? []
  const uniqueCount = frames.filter((frame) => frame.duplicateOf === null).length
  const first = frames[0]
  const last = frames[frames.length - 1]
  return {
    dir,
    frameCount: frames.length,
    uniqueCount,
    duplicateRatio: frames.length === 0 ? 0 : 1 - uniqueCount / frames.length,
    durationMs: first && last ? Math.max(0, Math.round((last.at - first.at) / 1000)) : 0,
    files: readdirSync(bundle.framesDir).sort(),
  }
}

export function inspectRecordingBundle(path: string): BundleInspection {
  const tapePath = resolve(path)
  const tape = parseTape(readFileSync(tapePath, "utf-8"))
  const framesDir = resolveFramesDir(tapePath, tape.settings.Frames)

  return {
    tapePath,
    backend: tape.settings.Backend ?? "unknown",
    commandCount: tape.commands.length,
    frameDebounceMs: tape.settings.FrameDebounceMs ? Number.parseInt(tape.settings.FrameDebounceMs, 10) : null,
    frameTrace: inspectFrameTrace(framesDir),
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function formatInspectSummary(summary: BundleInspection): string {
  const lines = [`Tape: ${summary.tapePath}`, `Backend: ${summary.backend}`, `Commands: ${summary.commandCount}`]
  if (summary.frameDebounceMs !== null) {
    lines.push(`Frame debounce: ${summary.frameDebounceMs}ms`)
  }

  if (summary.frameTrace === null) {
    lines.push("Frames: none")
    return lines.join("\n")
  }

  const trace = summary.frameTrace
  lines.push(`Frames dir: ${trace.dir}`)
  lines.push(
    `Frames: ${trace.frameCount} total, ${trace.uniqueCount} unique, ${formatPercent(trace.duplicateRatio)} duplicates`,
  )
  lines.push(`Duration: ${formatDuration(trace.durationMs)}`)
  lines.push(`Files: ${trace.files.join(", ")}`)
  return lines.join("\n")
}

export function registerInspectCommand(program: Command): void {
  program
    .command("inspect")
    .description("Inspect a .tape bundle and its .frames sidecar")
    .argument("<file>", "Tape file to inspect")
    .actionMerged((opts: { file: string }) => {
      console.log(formatInspectSummary(inspectRecordingBundle(opts.file)))
    })
}
