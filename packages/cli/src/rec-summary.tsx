/**
 * Post-exit recording summary — silvery component (inline render).
 *
 * Runs AFTER the PTY child has exited and the live overlay has been torn
 * down. The host terminal is back on the normal screen; silvery renders
 * inline at the cursor (no alt-screen takeover), shows a one-line
 * "Recorded …" header, and a per-file row with an animated {@link Spinner}
 * that swaps to a `✓` checkmark + size as each write completes.
 *
 * Note on stdin: silvery's `render(..., { mode: "inline" })` still owns
 * stdin for the duration of the mount — but we explicitly tear down the
 * recording's stdin handler BEFORE mounting this component, and the PTY
 * is already dead, so there is no competing consumer. `useApp().exit()`
 * fires from the effect once all writes complete, which unmounts cleanly.
 */

import React, { useEffect, useState } from "react"
import { Box, Muted, Spinner, Strong, Text, render, useApp } from "silvery"
import type { OutputTarget } from "./output-targets.ts"
import { writeOutputs, type CapturedSession, type WriteOutputsProgress } from "./rec-writer.ts"

/** One row's lifecycle state. */
type FileState =
  | { phase: "pending"; path: string }
  | { phase: "writing"; path: string }
  | { phase: "done"; path: string; bytes: number }

/** Props for {@link RecordSummary}. */
export interface RecordSummaryProps {
  cmdLabel: string
  durationMs: number
  cols: number
  rows: number
  keystrokeCount: number
  frameCount: number
  targets: readonly OutputTarget[]
  /** Runs the actual writes. Receives a progress hook to drive the React state. */
  writeFiles: (onProgress: WriteOutputsProgress) => Promise<unknown>
}

function formatDuration(ms: number): string {
  const sec = ms / 1000
  if (sec >= 1) return `${Math.round(sec)}s`
  return `${Math.round(ms)}ms`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

/**
 * The summary view — a header line and one row per output file.
 *
 * Files start in `pending` (no glyph), transition to `writing` (animated
 * spinner) when {@link writeOutputs}'s progress hook fires `phase=start`,
 * and land at `done` (✓ + byte size) on `phase=done`. The component calls
 * `useApp().exit()` once every file has reached `done`.
 */
export function RecordSummary({
  cmdLabel,
  durationMs,
  cols,
  rows,
  keystrokeCount,
  frameCount,
  targets,
  writeFiles,
}: RecordSummaryProps): React.ReactElement {
  const { exit } = useApp()
  const [files, setFiles] = useState<FileState[]>(() => targets.map((t) => ({ phase: "pending", path: t.path })))

  useEffect(() => {
    let cancelled = false
    const onProgress: WriteOutputsProgress = (event) => {
      setFiles((curr) =>
        curr.map((f, i) => {
          if (i !== event.index) return f
          if (event.phase === "start") return { phase: "writing", path: f.path }
          return { phase: "done", path: f.path, bytes: event.bytes ?? 0 }
        }),
      )
    }
    void writeFiles(onProgress).then(() => {
      if (!cancelled) exit()
    })
    return () => {
      cancelled = true
    }
  }, [writeFiles, exit])

  return (
    <Box flexDirection="column">
      <Text>
        Cmd <Strong>`{cmdLabel}`</Strong>
      </Text>
      <Text>
        Rec <Strong>{formatDuration(durationMs)}</Strong> at {cols}x{rows}, {plural(keystrokeCount, "keystroke")},{" "}
        {plural(frameCount, "frame")}
      </Text>
      {files.map((f, i) => (
        <Box key={i} flexDirection="row">
          <Text> </Text>
          {f.phase === "writing" ? (
            <Spinner type="dots" color="$warning" />
          ) : f.phase === "done" ? (
            <Text color="$success">✓</Text>
          ) : (
            <Muted>◌</Muted>
          )}
          <Text> {f.path}</Text>
          {f.phase === "done" ? (
            <>
              <Text> </Text>
              <Muted>{formatBytes(f.bytes)}</Muted>
            </>
          ) : f.phase === "writing" ? (
            <Muted> Writing...</Muted>
          ) : null}
        </Box>
      ))}
    </Box>
  )
}

/**
 * Mount {@link RecordSummary} inline, run the write workflow, await unmount.
 *
 * The recording session is over — PTY dead, overlay torn down. This renders
 * the summary INLINE at the host's normal-screen cursor (no alt-screen).
 */
export async function runRecordSummary(
  props: Omit<RecordSummaryProps, "writeFiles"> & {
    session: CapturedSession
    eventsToTape: (s: CapturedSession) => string
  },
): Promise<void> {
  const writeFiles: RecordSummaryProps["writeFiles"] = (onProgress) =>
    writeOutputs(props.targets, props.session, props.eventsToTape, onProgress)

  await render(<RecordSummary {...props} writeFiles={writeFiles} />, undefined, { mode: "inline" }).run()
}
