/**
 * Recording-consuming `view` rewrites — Phase 2 of the Recording-domain
 * unification.
 *
 * Proves `frame-viewer` and `animation/*` consume a unified `Recording`
 * rather than the old ad-hoc shapes:
 *  - `writeViewerFromRecording` emits a viewer from a `Recording`'s frames
 *    projection.
 *  - `recordingToPngFrames` / `recordingToAnimationFrames` derive the
 *    animation-encoder frame lists from a `Recording`.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeViewerFromRecording } from "../src/frame-viewer.ts"
import { recordingToPngFrames, recordingToAnimationFrames } from "../src/animation/from-recording.ts"
import { type Frame, type Recording, createRecording, micros } from "../src/recording-model.ts"

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "viewer-rec-"))
})

afterAll(() => {
  if (dir && statSync(dir).isDirectory()) rmSync(dir, { recursive: true, force: true })
})

function makeFrame(seq: number, atMicros: number, png: string | null, duplicateOf: number | null): Frame {
  return {
    seq,
    at: micros(atMicros),
    contentHash: `xxh64:${seq}`,
    duplicateOf,
    fingerprint: {
      backend: "vt100",
      fontFamily: "JetBrains Mono",
      fontSize: 14,
      cellSize: { width: 8, height: 16 },
      dpr: 2,
      theme: "default",
    },
    buffer: { cols: 20, rows: 5, cursor: { row: 0, col: seq } },
    ansiPreview: `frame ${seq}`,
    bytesInSinceLast: seq,
    png,
  }
}

function tracedRecording(): Recording {
  return createRecording({
    cols: 20,
    rows: 5,
    durationMicros: micros(300_000),
    frames: [
      makeFrame(1, 0, "00001.png", null),
      makeFrame(2, 100_000, "00002.png", null),
      makeFrame(3, 200_000, null, 1), // visual duplicate of frame 1
    ],
  })
}

describe("writeViewerFromRecording — frame-viewer consumes a Recording", () => {
  test("emits a viewer.html from a Recording frames projection", () => {
    // Stub PNG bytes for the two unique frames.
    writeFileSync(join(dir, "00001.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    writeFileSync(join(dir, "00002.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const result = writeViewerFromRecording(tracedRecording(), dir)
    expect(result.frameCount).toBe(3)
    expect(result.imageCount).toBe(2)

    const html = readFileSync(result.viewerFile, "utf-8")
    // The viewer's wire shape carries the on-disk field names.
    expect(html).toContain('"duplicate_of"')
    expect(html).toContain('"ansi_input_preview"')
    expect(html).toContain("frame 1")
  })

  test("throws for a recording with no frames projection", () => {
    const commandsOnly = createRecording({
      cols: 20,
      rows: 5,
      durationMicros: micros(0),
      commands: [{ kind: "sleep", at: micros(0), durationMicros: micros(0) }],
    })
    expect(() => writeViewerFromRecording(commandsOnly, dir)).toThrow(/no frames projection/)
  })
})

describe("recordingToPngFrames — animation consumes a Recording", () => {
  test("derives PngFrames with timeline-derived durations", () => {
    writeFileSync(join(dir, "00001.png"), Buffer.from([1, 2, 3]))
    writeFileSync(join(dir, "00002.png"), Buffer.from([4, 5, 6]))

    const pngFrames = recordingToPngFrames(tracedRecording(), dir)
    // Frame 3 is a visual duplicate — merged into frame 2's display time.
    expect(pngFrames).toHaveLength(2)
    // Frame 1 displays 100ms (gap to frame 2).
    expect(pngFrames[0]!.duration).toBe(100)
    // Frame 2 displays 100ms (gap to frame 3) + frame 3's trailing 100ms.
    expect(pngFrames[1]!.duration).toBe(200)
  })

  test("includeDuplicates keeps duplicate stills as their own frames", () => {
    writeFileSync(join(dir, "00001.png"), Buffer.from([1, 2, 3]))
    writeFileSync(join(dir, "00002.png"), Buffer.from([4, 5, 6]))

    const pngFrames = recordingToPngFrames(tracedRecording(), dir, { includeDuplicates: true })
    expect(pngFrames).toHaveLength(3)
    // Frame 3 (duplicate) resolves its PNG through duplicateOf → frame 1.
    expect([...pngFrames[2]!.png]).toEqual([1, 2, 3])
  })

  test("recordingToAnimationFrames derives SVG frames via a renderer", () => {
    const frames = recordingToAnimationFrames(tracedRecording(), (f) => `<svg>seq ${f.seq}</svg>`)
    expect(frames).toHaveLength(2) // duplicate merged
    expect(frames[0]!.svg).toBe("<svg>seq 1</svg>")
    expect(frames[0]!.duration).toBe(100)
  })

  test("throws for a recording with no frames projection", () => {
    const ioOnly = createRecording({
      cols: 20,
      rows: 5,
      durationMicros: micros(0),
      io: [{ at: micros(0), direction: "out", data: "x" }],
    })
    expect(() => recordingToPngFrames(ioOnly, dir)).toThrow(/no frames projection/)
  })
})
