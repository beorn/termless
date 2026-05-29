import { describe, expect, it } from "vitest"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { parseTape } from "../../../src/recording/tape/parser.ts"
import {
  compareSeparateOutputDir,
  playFrameReplayFromTape,
  resolveBackendNames,
  writeComparisonOutput,
} from "../src/play-cmd.ts"

const catalog = {
  names: () => ["vterm", "ghostty", "alacritty", "vt100"],
  ready: (name: string) => name !== "alacritty",
}

describe("resolveBackendNames", () => {
  it("leaves unspecified backend selection to the player default", () => {
    expect(resolveBackendNames(undefined, catalog)).toBeUndefined()
  })

  it("parses comma-separated backend names", () => {
    expect(resolveBackendNames("vterm, ghostty", catalog)).toEqual(["vterm", "ghostty"])
  })

  it("expands all to installed ready backends", () => {
    expect(resolveBackendNames("all", catalog)).toEqual(["vterm", "ghostty", "vt100"])
  })

  it("deduplicates explicit and all-expanded backend names while preserving order", () => {
    expect(resolveBackendNames("vt100,all,vterm", catalog)).toEqual(["vt100", "vterm", "ghostty"])
  })

  it("reports a useful error when all has no ready backends", () => {
    expect(() =>
      resolveBackendNames("all", {
        names: () => ["native"],
        ready: () => false,
      }),
    ).toThrow("No installed, ready backends")
  })
})

describe("comparison output helpers", () => {
  it("treats a trailing-slash separate comparison output as a directory", () => {
    expect(compareSeparateOutputDir("./screens/")).toBe("./screens")
  })

  it("uses the parent directory when separate comparison output names a file", () => {
    expect(compareSeparateOutputDir("./comparison.svg")).toBe(".")
    expect(compareSeparateOutputDir("artifacts/comparison.svg")).toBe("artifacts")
  })

  it("rasterizes composed comparison SVG when the output extension is .png", async () => {
    const dir = mkdtempSync(join(tmpdir(), "termless-play-"))
    try {
      const output = join(dir, "comparison.png")
      await writeComparisonOutput(
        output,
        '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#ff00ff"/></svg>',
      )

      expect(readFileSync(output).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("frame replay", () => {
  const onePixelPng = new Uint8Array(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64",
    ),
  )

  function writeTrace(dir: string): void {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "00001.png"), onePixelPng)
    writeFileSync(join(dir, "00002.png"), onePixelPng)
    writeFileSync(
      join(dir, "index.jsonl"),
      [
        JSON.stringify({
          seq: 1,
          ts: 1000,
          iso: "2026-05-29T00:00:01.000Z",
          hash: "a",
          duplicate_of: null,
          bytes_in_since_last: 4,
          ansi_input_preview: "test",
          buffer: { cols: 1, rows: 1, cursor: { row: 0, col: 0 } },
          duration_since_prev_ms: 0,
          render_ms: 1,
          png: "00001.png",
        }),
        JSON.stringify({
          seq: 2,
          ts: 1042,
          iso: "2026-05-29T00:00:01.042Z",
          hash: "b",
          duplicate_of: null,
          bytes_in_since_last: 0,
          ansi_input_preview: "",
          buffer: { cols: 1, rows: 1, cursor: { row: 0, col: 0 } },
          duration_since_prev_ms: 42,
          render_ms: 1,
          png: "00002.png",
        }),
      ].join("\n") + "\n",
    )
  }

  it("renders a GIF from the tape's frame trace without executing the tape", async () => {
    const dir = mkdtempSync(join(tmpdir(), "termless-play-frames-"))
    try {
      const tapePath = join(dir, "demo.tape")
      const framesDir = join(dir, "demo.frames")
      const output = join(dir, "demo.gif")
      writeTrace(framesDir)
      writeFileSync(tapePath, 'Set Frames "./demo.frames"\nRequire "this-command-must-not-run"\n')

      const result = await playFrameReplayFromTape(tapePath, parseTape(readFileSync(tapePath, "utf-8")), {
        output: [output],
      })

      expect(result.framesDir).toBe(framesDir)
      expect(result.frameCount).toBe(2)
      expect(readFileSync(output).subarray(0, 6).toString("ascii")).toBe("GIF89a")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
