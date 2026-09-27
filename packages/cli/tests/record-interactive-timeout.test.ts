/**
 * @failure Interactive `record --timeout` waited for child exit and never wrote its artifact.
 * @level l2
 * @consumer Termless CLI users recording a long-running terminal app.
 * @testonly none
 */

import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, test } from "vitest"

const cli = resolve(import.meta.dirname, "../bin/termless.ts")
const longLivedChild = 'process.stdout.write("boot\\n"); setTimeout(() => {}, 10000)'

function record(output: string, options: string[], childScript: string, timeout = 6000) {
  return spawnSync(
    "bun",
    [cli, "record", ...options, "--live-chrome", "none", "-o", output, "--", process.execPath, "-e", childScript],
    { encoding: "utf8", timeout },
  )
}

function readCast(output: string): { header: Record<string, unknown>; events: Array<[number, string, string]> } {
  const [header, ...events] = readFileSync(output, "utf8").trim().split("\n")
  return {
    header: JSON.parse(header!) as Record<string, unknown>,
    events: events.map((line) => JSON.parse(line) as [number, string, string]),
  }
}

describe("interactive record timeout", () => {
  test("stops a long-running child and saves its output at the requested deadline", { timeout: 10_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "termless-record-timeout-"))
    const output = join(dir, "session.cast")
    try {
      const result = record(output, ["--timeout", "1000"], longLivedChild)

      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).toBe(0)
      const { header, events } = readCast(output)
      expect(header.duration).toBeLessThan(2.5)
      expect(header.ended).toBe("timeout")
      expect(header.timeoutMs).toBe(1000)
      expect(events.some((event) => event[2].includes("boot"))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("stops after --wait-for text is visible and saves the recording", { timeout: 10_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "termless-record-wait-match-"))
    const output = join(dir, "session.cast")
    try {
      const child =
        'process.stdout.write("boot\\n"); setTimeout(() => process.stdout.write("ready\\n"), 300); setTimeout(() => {}, 10000)'
      const result = record(output, ["--wait-for", "ready"], child)

      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).toBe(0)
      const { header, events } = readCast(output)
      expect(header.ended).toBe("wait-for")
      expect(events.some((event) => event[2].includes("ready"))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("reports an early child exit without claiming the timeout elapsed", { timeout: 15_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "termless-record-early-exit-"))
    const output = join(dir, "session.cast")
    try {
      const result = record(output, ["--timeout", "1000"], 'process.stdout.write("done\\n")', 12_000)

      expect(result.error, result.stderr).toBeUndefined()
      expect(result.status, result.stderr).toBe(0)
      const { header, events } = readCast(output)
      expect(header.ended).toBe("child-exit")
      expect(events.some((event) => event[2].includes("done"))).toBe(true)
      expect(result.stderr).toContain("Recording ended: child-exit; saved:")
      expect(result.stderr).not.toContain("after 1000ms")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("writes the artifact and reports an unmatched --wait-for", { timeout: 10_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "termless-record-wait-miss-"))
    const output = join(dir, "session.cast")
    try {
      const result = record(output, ["--wait-for", "never-shown", "--timeout", "1000"], longLivedChild)

      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).not.toBe(0)
      const { header, events } = readCast(output)
      expect(header.ended).toBe("wait-for-timeout")
      expect(events.some((event) => event[2].includes("boot"))).toBe(true)
      expect(result.stderr).toContain("never-shown")
      expect(result.stderr).toContain("1000")
      expect(result.stderr).toContain(output)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("keeps interactive recording unbounded when no stop option is given", { timeout: 25_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "termless-record-unbounded-"))
    const output = join(dir, "session.cast")
    try {
      const child = 'process.stdout.write("boot\\n"); setTimeout(() => {}, 5600)'
      const result = record(output, [], child, 20_000)

      expect(result.error, result.stderr).toBeUndefined()
      expect(result.status, result.stderr).toBe(0)
      const { header } = readCast(output)
      expect(header.duration).toBeGreaterThan(5.2)
      expect(header.ended).toBe("child-exit")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("reports a timed image-only capture on stderr", { timeout: 10_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "termless-record-image-timeout-"))
    const output = join(dir, "session.svg")
    try {
      const result = record(output, ["--timeout", "1000"], longLivedChild)

      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).toBe(0)
      expect(readFileSync(output, "utf8")).toContain("<svg")
      expect(result.stderr).toContain("Recording ended: timeout after 1000ms")
      expect(result.stderr).toContain(output)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test.skipIf(process.platform === "win32")(
    "writes the artifact when the recorder receives a signal",
    { timeout: 10_000 },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "termless-record-signal-"))
      const output = join(dir, "session.cast")
      try {
        const result = await new Promise<{ code: number | null; stderr: string }>((resolveExit, rejectExit) => {
          const child = spawn(
            "bun",
            [
              cli,
              "record",
              "--live-chrome",
              "none",
              "-o",
              output,
              "--",
              process.execPath,
              "-e",
              'process.stdout.write("boot\\n"); process.on("SIGTERM", () => { process.stdout.write("tail\\n"); process.exit(0) }); setInterval(() => {}, 1000)',
            ],
            { stdio: ["ignore", "pipe", "pipe"] },
          )
          let stderr = ""
          let signaled = false
          const deadline = setTimeout(() => {
            child.kill("SIGKILL")
            rejectExit(new Error("recorder did not finish after SIGTERM"))
          }, 8000)
          child.stdout.on("data", (chunk: Buffer) => {
            if (!signaled && chunk.toString().includes("boot")) {
              signaled = true
              child.kill("SIGTERM")
            }
          })
          child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString()
          })
          child.on("error", rejectExit)
          child.on("close", (code) => {
            clearTimeout(deadline)
            resolveExit({ code, stderr })
          })
        })

        expect(result.code, result.stderr).toBe(143)
        expect(readCast(output).header.ended).toBe("signal")
        expect(readCast(output).events.some((event) => event[2].includes("tail"))).toBe(true)
        expect(result.stderr).toContain(output)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
})
