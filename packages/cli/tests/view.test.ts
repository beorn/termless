/**
 * `termless view` — the view verb. Scrub mode writes a self-contained
 * `viewer.html`; animate mode (`--format gif`) writes a GIF.
 */
import { describe, expect, it } from "vitest"
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { viewAction } from "../src/view-cmd.ts"

const here = dirname(fileURLToPath(import.meta.url))
/** The legacy frame-trace fixture — a bare `index.jsonl` + `00001.png`. */
const FIXTURE = join(here, "../../../tests/fixtures/legacy-frame-trace")

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "view-cmd-test-"))
}

describe("termless view — scrub mode (default)", () => {
  it("writes a self-contained viewer.html alongside a frame-trace recording", async () => {
    const dir = tmp()
    try {
      const recording = join(dir, "trace")
      cpSync(FIXTURE, recording, { recursive: true })

      await viewAction({ recording })

      const viewer = join(recording, "viewer.html")
      expect(existsSync(viewer)).toBe(true)
      const html = readFileSync(viewer, "utf-8")
      expect(html.toLowerCase()).toContain("<!doctype html>")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("termless view — animate mode (--format)", () => {
  it("rejects --format gif without an output path", async () => {
    const dir = tmp()
    const prevExit = process.exitCode
    try {
      const recording = join(dir, "trace")
      cpSync(FIXTURE, recording, { recursive: true })

      await viewAction({ recording, format: "gif" })
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = prevExit
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("rejects an unsupported animation format", async () => {
    const dir = tmp()
    const prevExit = process.exitCode
    try {
      const recording = join(dir, "trace")
      cpSync(FIXTURE, recording, { recursive: true })

      await viewAction({ recording, format: "apng", output: join(dir, "out.apng") })
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = prevExit
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("encodes a recording's frames into a GIF", async () => {
    const dir = tmp()
    try {
      const recording = join(dir, "trace")
      cpSync(FIXTURE, recording, { recursive: true })
      const out = join(dir, "demo.gif")

      await viewAction({ recording, format: "gif", output: out })

      expect(existsSync(out)).toBe(true)
      // GIF89a magic header.
      const head = readFileSync(out).subarray(0, 6).toString("latin1")
      expect(head).toBe("GIF89a")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
