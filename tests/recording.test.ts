/**
 * Tests for the recording and replay system.
 *
 * Verifies event capture, timestamp ordering, stop semantics,
 * JSON serializability, instant replay via feed(), and visual
 * state snapshotting for frame change detection.
 */

import { describe, test, expect, vi } from "vitest"
import { startRecording, replayRecording, snapshotVisualState } from "../src/recording.ts"
import type { Recording, Terminal, TerminalReadable, Cell, CursorState, ScrollbackState, TerminalMode } from "../src/index.ts"

// =============================================================================
// Mock Terminal
// =============================================================================

function createMockTerminal(): Terminal & { fedData: string[] } {
  const fedData: string[] = []

  return {
    cols: 80,
    rows: 24,
    fedData,

    // Minimal Terminal interface stubs
    feed(data: Uint8Array | string): void {
      fedData.push(typeof data === "string" ? data : new TextDecoder().decode(data))
    },

    // Required by Terminal but not used in recording tests
    backend: null as never,
    getText: () => "",
    getTextRange: () => "",
    getCell: () => ({
      char: " ",
      fg: null,
      bg: null,
      bold: false,
      dim: false,
      italic: false,
      underline: false as const,
      underlineColor: null,
      strikethrough: false,
      inverse: false,
      blink: false,
      hidden: false,
      wide: false,
      continuation: false,
      hyperlink: null,
    }),
    getLine: () => [],
    getLines: () => [],
    getCursor: () => ({ x: 0, y: 0, visible: true, style: "block" as const }),
    getMode: () => false,
    getTitle: () => "",
    getScrollback: () => ({ viewportOffset: 0, totalLines: 24, screenLines: 24 }),
    screen: null as never,
    scrollback: null as never,
    buffer: null as never,
    viewport: null as never,
    row: () => null as never,
    cell: () => null as never,
    range: () => null as never,
    firstRow: () => null as never,
    lastRow: () => null as never,
    spawn: async () => {},
    alive: false,
    exitInfo: null,
    press: () => {},
    type: () => {},
    click: () => {},
    dblclick: async () => {},
    mouseDown: () => {},
    mouseUp: () => {},
    mouseMove: () => {},
    wheel: () => {},
    waitFor: async () => {},
    waitForStable: async () => {},
    find: () => null,
    findAll: () => [],
    screenshotSvg: () => "",
    screenshotPng: async () => new Uint8Array(),
    resize: () => {},
    clipboardWrites: [],
    close: async () => {},
    [Symbol.asyncDispose]: async () => {},
  }
}

// =============================================================================
// startRecording
// =============================================================================

describe("startRecording", () => {
  test("captures output events", () => {
    const terminal = createMockTerminal()
    const handle = startRecording(terminal)

    handle.recordOutput("$ ")
    handle.recordOutput("hello\n")
    const recording = handle.stop()

    expect(recording.events).toHaveLength(2)
    expect(recording.events[0]!.type).toBe("output")
    expect(recording.events[0]!.data).toBe("$ ")
    expect(recording.events[1]!.type).toBe("output")
    expect(recording.events[1]!.data).toBe("hello\n")
  })

  test("captures input events", () => {
    const terminal = createMockTerminal()
    const handle = startRecording(terminal)

    handle.recordInput("ls\n")
    const recording = handle.stop()

    expect(recording.events).toHaveLength(1)
    expect(recording.events[0]!.type).toBe("input")
    expect(recording.events[0]!.data).toBe("ls\n")
  })

  test("captures mixed input/output events", () => {
    const terminal = createMockTerminal()
    const handle = startRecording(terminal)

    handle.recordOutput("$ ")
    handle.recordInput("ls\n")
    handle.recordOutput("file1  file2\n$ ")
    const recording = handle.stop()

    expect(recording.events).toHaveLength(3)
    expect(recording.events.map((e) => e.type)).toEqual(["output", "input", "output"])
  })

  test("events have non-decreasing timestamps", () => {
    const terminal = createMockTerminal()
    const handle = startRecording(terminal)

    handle.recordOutput("a")
    handle.recordInput("b")
    handle.recordOutput("c")
    const recording = handle.stop()

    for (let i = 1; i < recording.events.length; i++) {
      expect(recording.events[i]!.timestamp).toBeGreaterThanOrEqual(recording.events[i - 1]!.timestamp)
    }
  })

  test("recording includes terminal dimensions", () => {
    const terminal = createMockTerminal()
    const handle = startRecording(terminal)
    const recording = handle.stop()

    expect(recording.cols).toBe(80)
    expect(recording.rows).toBe(24)
  })

  test("recording includes duration", () => {
    const terminal = createMockTerminal()
    const handle = startRecording(terminal)
    // Duration will be very small in tests
    const recording = handle.stop()
    expect(recording.duration).toBeGreaterThanOrEqual(0)
  })

  test("recording has version 1", () => {
    const terminal = createMockTerminal()
    const handle = startRecording(terminal)
    const recording = handle.stop()
    expect(recording.version).toBe(1)
  })

  test("throws when recording after stop", () => {
    const terminal = createMockTerminal()
    const handle = startRecording(terminal)
    handle.stop()

    expect(() => handle.recordOutput("x")).toThrow("Recording has been stopped")
    expect(() => handle.recordInput("y")).toThrow("Recording has been stopped")
  })

  test("throws when stopping twice", () => {
    const terminal = createMockTerminal()
    const handle = startRecording(terminal)
    handle.stop()

    expect(() => handle.stop()).toThrow("Recording has already been stopped")
  })

  test("recording is JSON-serializable", () => {
    const terminal = createMockTerminal()
    const handle = startRecording(terminal)
    handle.recordOutput("Hello\x1b[31m World\x1b[0m")
    handle.recordInput("\r")
    const recording = handle.stop()

    const json = JSON.stringify(recording)
    const parsed = JSON.parse(json) as Recording
    expect(parsed.version).toBe(1)
    expect(parsed.events).toHaveLength(2)
    expect(parsed.events[0]!.data).toBe("Hello\x1b[31m World\x1b[0m")
  })
})

// =============================================================================
// replayRecording
// =============================================================================

describe("replayRecording", () => {
  test("feeds output events to terminal", async () => {
    const terminal = createMockTerminal()
    const recording: Recording = {
      version: 1,
      cols: 80,
      rows: 24,
      duration: 100,
      events: [
        { timestamp: 0, type: "output", data: "$ " },
        { timestamp: 50, type: "output", data: "hello\n" },
      ],
    }

    await replayRecording(terminal, recording)
    expect(terminal.fedData).toEqual(["$ ", "hello\n"])
  })

  test("does not feed input events during replay", async () => {
    const terminal = createMockTerminal()
    const recording: Recording = {
      version: 1,
      cols: 80,
      rows: 24,
      duration: 100,
      events: [
        { timestamp: 0, type: "output", data: "$ " },
        { timestamp: 10, type: "input", data: "ls\n" },
        { timestamp: 50, type: "output", data: "file1\n" },
      ],
    }

    await replayRecording(terminal, recording)
    // Only output events should be fed
    expect(terminal.fedData).toEqual(["$ ", "file1\n"])
  })

  test("instant replay completes immediately", async () => {
    const terminal = createMockTerminal()
    const recording: Recording = {
      version: 1,
      cols: 80,
      rows: 24,
      duration: 10000,
      events: [
        { timestamp: 0, type: "output", data: "a" },
        { timestamp: 5000, type: "output", data: "b" },
        { timestamp: 10000, type: "output", data: "c" },
      ],
    }

    const start = Date.now()
    await replayRecording(terminal, recording)
    const elapsed = Date.now() - start

    // Instant replay should complete in well under 1 second
    expect(elapsed).toBeLessThan(1000)
    expect(terminal.fedData).toEqual(["a", "b", "c"])
  })

  test("empty recording replays without error", async () => {
    const terminal = createMockTerminal()
    const recording: Recording = {
      version: 1,
      cols: 80,
      rows: 24,
      duration: 0,
      events: [],
    }

    await replayRecording(terminal, recording)
    expect(terminal.fedData).toEqual([])
  })

  test("realtime replay uses setTimeout delays", async () => {
    vi.useFakeTimers()
    try {
      const terminal = createMockTerminal()
      const recording: Recording = {
        version: 1,
        cols: 80,
        rows: 24,
        duration: 200,
        events: [
          { timestamp: 0, type: "output", data: "a" },
          { timestamp: 100, type: "output", data: "b" },
          { timestamp: 200, type: "output", data: "c" },
        ],
      }

      let done = false
      const p = replayRecording(terminal, recording, { realtime: true }).then(() => {
        done = true
      })

      // Initially, first event is processed (timestamp 0, no delay)
      await vi.advanceTimersByTimeAsync(0)
      expect(terminal.fedData).toContain("a")

      // After 100ms, second event should fire
      await vi.advanceTimersByTimeAsync(100)
      expect(terminal.fedData).toContain("b")

      // After another 100ms, third event
      await vi.advanceTimersByTimeAsync(100)
      await p
      expect(done).toBe(true)
      expect(terminal.fedData).toEqual(["a", "b", "c"])
    } finally {
      vi.useRealTimers()
    }
  })
})

// =============================================================================
// snapshotVisualState
// =============================================================================

const DEFAULT_CELL: Cell = {
  char: " ",
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  underlineColor: null,
  strikethrough: false,
  inverse: false,
  blink: false,
  hidden: false,
  wide: false,
  continuation: false,
  hyperlink: null,
}

function createReadable(opts: {
  lines?: string[]
  cells?: Map<string, Partial<Cell>>
  cursor?: Partial<CursorState>
  modes?: Partial<Record<TerminalMode, boolean>>
  title?: string
} = {}): TerminalReadable {
  const { lines = [""], cells = new Map(), cursor = {}, modes = {}, title = "" } = opts
  const maxCols = Math.max(...lines.map((l) => l.length), 1)

  const grid: Cell[][] = lines.map((line, row) => {
    const rowCells: Cell[] = []
    for (let col = 0; col < maxCols; col++) {
      const key = `${row},${col}`
      const overrides = cells.get(key) ?? {}
      rowCells.push({ ...DEFAULT_CELL, char: line[col] ?? " ", ...overrides })
    }
    return rowCells
  })

  const cursorState: CursorState = {
    x: cursor.x ?? 0,
    y: cursor.y ?? 0,
    visible: cursor.visible ?? true,
    style: cursor.style ?? "block",
  }

  return {
    getText: () => grid.map((r) => r.map((c) => c.char || " ").join("")).join("\n"),
    getTextRange: () => "",
    getCell: (row, col) => grid[row]?.[col] ?? { ...DEFAULT_CELL },
    getLine: (row) => grid[row] ?? [],
    getLines: () => grid,
    getCursor: () => cursorState,
    getMode: (mode: TerminalMode) => modes[mode] ?? false,
    getTitle: () => title,
    getScrollback: (): ScrollbackState => ({ viewportOffset: 0, totalLines: grid.length, screenLines: grid.length }),
  }
}

describe("snapshotVisualState", () => {
  test("identical terminals produce identical snapshots", () => {
    const a = createReadable({ lines: ["Hello"] })
    const b = createReadable({ lines: ["Hello"] })
    expect(snapshotVisualState(a)).toBe(snapshotVisualState(b))
  })

  test("different text produces different snapshots", () => {
    const a = createReadable({ lines: ["Hello"] })
    const b = createReadable({ lines: ["World"] })
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("detects foreground color changes", () => {
    const a = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { fg: { r: 255, g: 0, b: 0 } }]]),
    })
    const b = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { fg: { r: 0, g: 255, b: 0 } }]]),
    })
    // Same text "X" but different fg color — must produce different snapshots
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("detects background color changes", () => {
    const a = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { bg: { r: 0, g: 0, b: 255 } }]]),
    })
    const b = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { bg: null }]]),
    })
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("detects bold style changes", () => {
    const a = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { bold: true }]]),
    })
    const b = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { bold: false }]]),
    })
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("detects italic style changes", () => {
    const a = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { italic: true }]]),
    })
    const b = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { italic: false }]]),
    })
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("detects underline style changes", () => {
    const a = createReadable({
      lines: ["X"],
      cells: new Map<string, Partial<Cell>>([["0,0", { underline: "single" }]]),
    })
    const b = createReadable({
      lines: ["X"],
      cells: new Map<string, Partial<Cell>>([["0,0", { underline: false }]]),
    })
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("detects cursor position changes", () => {
    const a = createReadable({ lines: ["Hello"], cursor: { x: 0, y: 0 } })
    const b = createReadable({ lines: ["Hello"], cursor: { x: 5, y: 0 } })
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("detects cursor style changes", () => {
    const a = createReadable({ lines: ["Hello"], cursor: { style: "block" } })
    const b = createReadable({ lines: ["Hello"], cursor: { style: "beam" } })
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("detects cursor visibility changes", () => {
    const a = createReadable({ lines: ["Hello"], cursor: { visible: true } })
    const b = createReadable({ lines: ["Hello"], cursor: { visible: false } })
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("detects title changes", () => {
    const a = createReadable({ lines: ["Hello"], title: "Terminal 1" })
    const b = createReadable({ lines: ["Hello"], title: "Terminal 2" })
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("detects alt screen mode changes", () => {
    const a = createReadable({ lines: ["Hello"], modes: { altScreen: false } })
    const b = createReadable({ lines: ["Hello"], modes: { altScreen: true } })
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("detects inverse style changes", () => {
    const a = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { inverse: true }]]),
    })
    const b = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { inverse: false }]]),
    })
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("detects strikethrough style changes", () => {
    const a = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { strikethrough: true }]]),
    })
    const b = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { strikethrough: false }]]),
    })
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("detects dim style changes", () => {
    const a = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { dim: true }]]),
    })
    const b = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { dim: false }]]),
    })
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("detects hyperlink changes", () => {
    const a = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { hyperlink: "https://example.com" }]]),
    })
    const b = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { hyperlink: null }]]),
    })
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("snapshot is deterministic (multiple calls return same value)", () => {
    const readable = createReadable({
      lines: ["Hello", "World"],
      cells: new Map([["0,0", { bold: true, fg: { r: 255, g: 0, b: 0 } }]]),
      cursor: { x: 3, y: 1, style: "beam", visible: true },
      title: "test",
    })
    const s1 = snapshotVisualState(readable)
    const s2 = snapshotVisualState(readable)
    expect(s1).toBe(s2)
  })
})
