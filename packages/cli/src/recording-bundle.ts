import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { readBundle, unpackRecording } from "@termless/core"

export function openRecordingBundle(path: string) {
  const source = resolve(path)
  let rootDir = source
  let cleanup = () => {}

  if (existsSync(source) && statSync(source).isFile()) {
    rootDir = mkdtempSync(join(tmpdir(), "termless-view-"))
    unpackRecording(source, rootDir)
    cleanup = () => rmSync(rootDir, { recursive: true, force: true })
  }

  try {
    const result = readBundle(rootDir)
    const framesMember = result.manifest.members.find((member) => member.type === "frames")
    if (!framesMember) {
      throw new Error(`recording bundle has no frames member: ${source}`)
    }
    return {
      ...result,
      framesDir: resolve(rootDir, dirname(framesMember.path)),
      [Symbol.dispose]: cleanup,
    }
  } catch (error) {
    cleanup()
    throw error
  }
}
