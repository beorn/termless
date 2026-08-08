/** Open any supported Recording container and own its temporary unpacking. */

import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { readRecording, unpackRecording, type Recording } from "@termless/core"

export interface RecordingBundle extends Disposable {
  recording: Recording
  rootDir: string
  framesDir: string
}

/**
 * Read a canonical `.rec` file/directory or a legacy frame-trace directory.
 *
 * Single-file containers are unpacked for the lifetime of the returned
 * resource so frame consumers never need to know either on-disk layout.
 */
export function readBundle(path: string): RecordingBundle {
  const source = resolve(path)
  let rootDir = source
  let cleanup = () => {}

  if (existsSync(source) && statSync(source).isFile()) {
    rootDir = mkdtempSync(join(tmpdir(), "termless-rec-"))
    unpackRecording(source, rootDir)
    cleanup = () => rmSync(rootDir, { recursive: true, force: true })
  }

  try {
    const recording = readRecording(rootDir)
    const nestedFramesDir = join(rootDir, "frames")
    const framesDir = existsSync(nestedFramesDir) && statSync(nestedFramesDir).isDirectory() ? nestedFramesDir : rootDir
    return {
      recording,
      rootDir,
      framesDir,
      [Symbol.dispose]: cleanup,
    }
  } catch (error) {
    cleanup()
    throw error
  }
}
