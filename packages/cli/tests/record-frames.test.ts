import { describe, expect, test } from "vitest"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { eventsToTape } from "../src/record-cmd.ts"
import {
  tapeFrameTraceDir,
  writeOutputs,
  type CapturedSession,
  type OutputFrameTraceOptions,
} from "../src/rec-writer.ts"

async function withTempDir(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "termless-record-frames-"))
  try {
    await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function session(): CapturedSession {
  return {
    cols: 2,
    rows: 1,
    durationMs: 84,
    command: ["demo"],
    inputEvents: [],
    outputEvents: [],
    frames: [
      {
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="1"><text>a</text></svg>',
        duration: 42,
      },
      {
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="1"><text>b</text></svg>',
        duration: 42,
      },
    ],
    renderer: "resvg",
    scale: 2,
  }
}

describe("record frame sidecars", () => {
  test("derives the default .frames directory from a tape output path", () => {
    expect(tapeFrameTraceDir("demo.tape")).toBe("demo.frames")
    expect(tapeFrameTraceDir("out/session.tape")).toBe("out/session.frames")
  })

  test("writes a tape plus sibling frame trace by default", async () =>
    withTempDir(async (dir) => {
      const tapePath = join(dir, "demo.tape")
      const renderFramePng: OutputFrameTraceOptions["renderFramePng"] = async (_frame, index) =>
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, index])

      await writeOutputs(
        [{ path: tapePath, format: "tape" }],
        session(),
        (captured, ctx) => eventsToTape(captured.inputEvents, captured.command.join(" "), false, ctx?.tape),
        undefined,
        { frameTrace: { enabled: true, renderFramePng } },
      )

      const tape = readFileSync(tapePath, "utf-8")
      expect(tape).toContain('Set Frames "./demo.frames"')
      expect(
        readFileSync(join(dir, "demo.frames", "index.jsonl"), "utf-8")
          .trim()
          .split("\n"),
      ).toHaveLength(2)
      expect(Array.from(readFileSync(join(dir, "demo.frames", "00001.png")))).toEqual([0x89, 0x50, 0x4e, 0x47, 0])
      expect(Array.from(readFileSync(join(dir, "demo.frames", "00002.png")))).toEqual([0x89, 0x50, 0x4e, 0x47, 1])
    }))

  test("respects an explicit frames dir and debounce header", async () =>
    withTempDir(async (dir) => {
      const tapePath = join(dir, "nested", "demo.tape")
      const framesDir = join(dir, "frames", "custom")
      const renderFramePng: OutputFrameTraceOptions["renderFramePng"] = async (_frame, index) =>
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, index])

      await writeOutputs(
        [{ path: tapePath, format: "tape" }],
        session(),
        (captured, ctx) => eventsToTape(captured.inputEvents, captured.command.join(" "), false, ctx?.tape),
        undefined,
        { frameTrace: { enabled: true, dir: framesDir, frameDebounceMs: 24, renderFramePng } },
      )

      const tape = readFileSync(tapePath, "utf-8")
      expect(tape).toContain('Set Frames "../frames/custom"')
      expect(tape).toContain("Set FrameDebounceMs 24")
      expect(readFileSync(join(framesDir, "index.jsonl"), "utf-8").trim().split("\n")).toHaveLength(2)
    }))

  test("respects --no-frames by omitting Set Frames and the sidecar directory", async () =>
    withTempDir(async (dir) => {
      const tapePath = join(dir, "demo.tape")
      await writeOutputs(
        [{ path: tapePath, format: "tape" }],
        session(),
        (captured, ctx) => eventsToTape(captured.inputEvents, captured.command.join(" "), false, ctx?.tape),
        undefined,
        { frameTrace: { enabled: false } },
      )

      const tape = readFileSync(tapePath, "utf-8")
      expect(tape).not.toContain("Set Frames")
      expect(() => readFileSync(join(dir, "demo.frames", "index.jsonl"))).toThrow()
    }))
})
