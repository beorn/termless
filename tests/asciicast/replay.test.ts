/**
 * Tests for asciicast v2 replayer.
 *
 * Verifies replaying through a real vt100 backend, terminal state
 * after replay, and speed multiplier behavior.
 */

import { describe, test, expect, vi } from "vitest"
import { parseAsciicast, replayAsciicast } from "../../src/asciicast/reader.ts"
import { createTerminal } from "../../src/terminal.ts"
import type { AsciicastRecording } from "../../src/asciicast/types.ts"

// Use vt100 backend — pure TypeScript, no native deps
async function loadVt100Backend() {
  const { createVt100Backend } = await import("@termless/vt100")
  return createVt100Backend()
}

describe("replayAsciicast", () => {
  test("replays output through a terminal", async () => {
    const backend = await loadVt100Backend()
    const term = createTerminal({ backend, cols: 80, rows: 24 })

    const recording: AsciicastRecording = {
      header: { version: 2, width: 80, height: 24 },
      events: [
        { time: 0, type: "o", data: "Hello, " },
        { time: 0.5, type: "o", data: "World!" },
      ],
    }

    await replayAsciicast(recording, term, { speed: Infinity })

    expect(term.screen.getText()).toContain("Hello, World!")
  })

  test("skips input events during replay", async () => {
    const backend = await loadVt100Backend()
    const term = createTerminal({ backend, cols: 80, rows: 24 })

    const recording: AsciicastRecording = {
      header: { version: 2, width: 80, height: 24 },
      events: [
        { time: 0, type: "o", data: "$ " },
        { time: 0.5, type: "i", data: "ls\n" },
        { time: 1.0, type: "o", data: "file1\r\n" },
      ],
    }

    await replayAsciicast(recording, term, { speed: Infinity })

    const text = term.screen.getText()
    expect(text).toContain("$ ")
    expect(text).toContain("file1")
    // Input "ls\n" should NOT appear as terminal output
    expect(text).not.toContain("ls")
  })

  test("handles ANSI escape sequences", async () => {
    const backend = await loadVt100Backend()
    const term = createTerminal({ backend, cols: 80, rows: 24 })

    const recording: AsciicastRecording = {
      header: { version: 2, width: 80, height: 24 },
      events: [{ time: 0, type: "o", data: "\x1b[1mBold\x1b[0m Normal" }],
    }

    await replayAsciicast(recording, term, { speed: Infinity })

    expect(term.screen.getText()).toContain("Bold Normal")
  })

  test("calls onEvent callback for each event", async () => {
    const backend = await loadVt100Backend()
    const term = createTerminal({ backend, cols: 80, rows: 24 })

    const recording: AsciicastRecording = {
      header: { version: 2, width: 80, height: 24 },
      events: [
        { time: 0, type: "o", data: "a" },
        { time: 0.1, type: "i", data: "b" },
        { time: 0.2, type: "m", data: "marker" },
      ],
    }

    const events: string[] = []
    await replayAsciicast(recording, term, {
      speed: Infinity,
      onEvent: (e) => events.push(`${e.type}:${e.data}`),
    })

    expect(events).toEqual(["o:a", "i:b", "m:marker"])
  })

  test("speed multiplier affects timing", async () => {
    vi.useFakeTimers()
    try {
      const backend = await loadVt100Backend()
      const term = createTerminal({ backend, cols: 80, rows: 24 })

      const recording: AsciicastRecording = {
        header: { version: 2, width: 80, height: 24 },
        events: [
          { time: 0, type: "o", data: "a" },
          { time: 1.0, type: "o", data: "b" }, // 1 second gap
        ],
      }

      // 2x speed: 1 second gap → 500ms delay
      let done = false
      const p = replayAsciicast(recording, term, { speed: 2 }).then(() => {
        done = true
      })

      // First event at t=0 — no delay
      await vi.advanceTimersByTimeAsync(0)
      expect(term.screen.getText()).toContain("a")

      // At 250ms, shouldn't be done yet
      await vi.advanceTimersByTimeAsync(250)
      expect(done).toBe(false)

      // At 500ms (1000ms / speed=2), second event fires
      await vi.advanceTimersByTimeAsync(250)
      await p
      expect(done).toBe(true)
      expect(term.screen.getText()).toContain("b")
    } finally {
      vi.useRealTimers()
    }
  })

  test("instant replay with speed=0", async () => {
    const backend = await loadVt100Backend()
    const term = createTerminal({ backend, cols: 80, rows: 24 })

    const recording: AsciicastRecording = {
      header: { version: 2, width: 80, height: 24 },
      events: [
        { time: 0, type: "o", data: "a" },
        { time: 100, type: "o", data: "b" }, // 100 seconds
        { time: 200, type: "o", data: "c" }, // 200 seconds
      ],
    }

    const start = Date.now()
    await replayAsciicast(recording, term, { speed: 0 })
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(1000)
    expect(term.screen.getText()).toContain("abc")
  })

  test("replays parsed asciicast end-to-end", async () => {
    const backend = await loadVt100Backend()
    const term = createTerminal({ backend, cols: 80, rows: 24 })

    const content = [
      '{"version": 2, "width": 80, "height": 24}',
      '[0.0, "o", "$ "]',
      '[0.3, "o", "echo hi"]',
      '[0.5, "o", "\\r\\nhi\\r\\n$ "]',
    ].join("\n")

    const recording = parseAsciicast(content)
    await replayAsciicast(recording, term, { speed: Infinity })

    const text = term.screen.getText()
    expect(text).toContain("$ echo hi")
    expect(text).toContain("hi")
  })

  test("replays directly into a TerminalBackend", async () => {
    const backend = await loadVt100Backend()
    backend.init({ cols: 80, rows: 24 })

    const recording: AsciicastRecording = {
      header: { version: 2, width: 80, height: 24 },
      events: [{ time: 0, type: "o", data: "Hello backend" }],
    }

    await replayAsciicast(recording, backend, { speed: Infinity })

    expect(backend.getText()).toContain("Hello backend")
  })
})
