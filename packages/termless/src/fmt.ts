/**
 * `termless/fmt` — the `.tty` / `.ttyz` recording format: one format, two
 * encodings (a live bundle directory and a sealed ZIP archive), one
 * encoding-blind reader. No engine: format types and the read/write surface
 * only. See `docs/reference/formats/tty.md` for the full spec.
 */

export {
  isTtyPath,
  isTtyzPath,
  packRecording,
  readBundle,
  readRecording,
  TTY_FORMAT_VERSION,
  unpackRecording,
  writeRecording,
} from "@termless/core"

export type {
  ReadBundleResult,
  TtyManifest,
  TtyMember,
  TtyMemberEncoding,
  TtyMemberType,
  TtySkipTally,
  TtyTail,
  WriteRecordingOptions,
} from "@termless/core"

// ZIP container codec backing the sealed (`.ttyz`) encoding.
export { buildZip, parseZip } from "@termless/core"
export type { ZipEntry } from "@termless/core"
