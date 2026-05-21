/**
 * `termless record` output-target resolution.
 *
 * `record` has exactly one output flag — `-o`. The *shape* of each `-o` value
 * picks the output mode. There is no separate format flag and no separate
 * still-image flag — every output is a `-o` path whose extension or trailing
 * slash decides the rest:
 *
 * | `-o` value                | Mode                                                       |
 * | ------------------------- | ---------------------------------------------------------- |
 * | _(absent)_                | default — `out.gif` in the cwd                             |
 * | trailing `/` or a dir     | folder bundle — `<dir>/out.{rec,gif,cast,tape}`            |
 * | has an extension          | that single file                                          |
 * | repeated, extensioned     | each named file                                            |
 *
 * An extension maps to a {@link OutputFormat}; the format decides whether a
 * renderer is involved (see `renderer.ts`).
 */

import { existsSync, statSync } from "node:fs"
import { basename, join } from "node:path"

/** The recording output formats `record` can write, keyed by file extension. */
export type OutputFormat = "rec" | "gif" | "apng" | "png" | "svg" | "html" | "cast" | "tape"

/** One resolved output target — an absolute-or-relative path and its format. */
export interface OutputTarget {
  /** The file path to write. */
  path: string
  /** The format, derived from the path's extension. */
  format: OutputFormat
}

/** Map a lowercased file extension (no dot) to an {@link OutputFormat}. */
const EXT_TO_FORMAT: Record<string, OutputFormat> = {
  rec: "rec",
  gif: "gif",
  apng: "apng",
  png: "png",
  svg: "svg",
  html: "html",
  cast: "cast",
  tape: "tape",
}

/** The fixed set a folder bundle (`-o demos/`) writes. */
const FOLDER_BUNDLE: OutputFormat[] = ["rec", "gif", "cast", "tape"]

/** Whether a path string denotes a folder (trailing `/`, or an existing dir). */
function isFolderPath(value: string): boolean {
  if (value.endsWith("/") || value.endsWith("\\")) return true
  return existsSync(value) && statSync(value).isDirectory()
}

/** The extension of `path` (lowercased, no dot), or `null` when it has none. */
function extensionOf(path: string): string | null {
  const name = basename(path)
  const dot = name.lastIndexOf(".")
  if (dot <= 0) return null
  return name.slice(dot + 1).toLowerCase()
}

/**
 * Resolve raw `-o` values into the concrete set of {@link OutputTarget}s
 * `record` should write.
 *
 * @param outputs The raw `-o` values, in order. Empty when `-o` was absent.
 * @returns The resolved targets. Never empty — an absent `-o` yields the
 *   default `out.gif`.
 * @throws {Error} when a value has an unrecognised extension.
 */
export function resolveOutputTargets(outputs: readonly string[]): OutputTarget[] {
  // Absent `-o` → the README-fit default: a single GIF in the cwd.
  if (outputs.length === 0) {
    return [{ path: "out.gif", format: "gif" }]
  }

  const targets: OutputTarget[] = []
  for (const value of outputs) {
    if (isFolderPath(value)) {
      // Folder bundle — the fixed `rec`/`gif`/`cast`/`tape` set under `<dir>/`.
      const dir = value.replace(/[/\\]+$/, "")
      for (const format of FOLDER_BUNDLE) {
        targets.push({ path: join(dir, `out.${format}`), format })
      }
      continue
    }

    const ext = extensionOf(value)
    if (ext === null) {
      throw new Error(
        `record: -o "${value}" has no extension and is not a folder. ` +
          `Use a trailing slash for a folder bundle (-o demos/) or name a file (-o out.gif).`,
      )
    }
    const format = EXT_TO_FORMAT[ext]
    if (format === undefined) {
      throw new Error(
        `record: -o "${value}" — unknown extension ".${ext}". ` + `Known: ${Object.keys(EXT_TO_FORMAT).join(", ")}.`,
      )
    }
    targets.push({ path: value, format })
  }
  return targets
}

/** The raster formats — these consult the renderer (`png`/`gif`/`apng`). */
const RASTER_FORMATS = new Set<OutputFormat>(["png", "gif", "apng"])

/** Whether `format` is a raster image whose pixels come from a renderer. */
export function isRasterFormat(format: OutputFormat): boolean {
  return RASTER_FORMATS.has(format)
}
