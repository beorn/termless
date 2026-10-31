/**
 * The shadow-rename adapters — the legacy shapes driven through the io
 * primitives.
 *
 * These prove the old surface and the new one describe the same terminal, so
 * phase A2 can move consumers one at a time instead of all at once.
 */

import { describe, expect, test } from "vitest"
import { createXtermBackend } from "../../packages/xtermjs/src/backend.ts"
import { createVtermBackend } from "../../packages/vterm/src/backend.ts"
import { createVt100Backend } from "../../packages/vt100/src/backend.ts"
import { createVt220Backend } from "../../packages/vt220/src/backend.ts"
import type { Mode } from "../../src/io/picture.ts"
import { emulatorFromBackend } from "../../src/terminal/io-compat.ts"
import { eventFromIoEvent, ioEventFromEvent } from "../../src/recording/io-compat.ts"
import { micros, pipe, type Event } from "../../src/io/index.ts"
import type { IoEvent } from "../../src/recording/recording.ts"
import { FIXTURE_SIZE, bytes, conformanceEvents, text } from "./fixtures.ts"

describe("emulatorFromBackend", () => {
  test("drives a real backend from an Event stream", async () => {
    const backend = createXtermBackend()
    backend.init({ cols: FIXTURE_SIZE.cols, rows: FIXTURE_SIZE.rows })
    const emulator = emulatorFromBackend(backend, FIXTURE_SIZE)

    await pipe(
      (async function* () {
        for (const e of conformanceEvents()) yield e
      })(),
      emulator,
    )

    expect(emulator.getText()).toContain("hello world")
    expect(emulator.getCell(0, 0).char).toBe("h")
    expect(emulator.cursor.col).toBe("hello world".length)
    expect(emulator.size).toEqual(FIXTURE_SIZE)
    expect(emulator.scrollback).toBe(0)

    backend.destroy()
  })

  test("scrollback mirrors the backend's history rows, so absolute rows map to the screen", async () => {
    const backend = createXtermBackend()
    backend.init({ cols: 80, rows: 24 })
    const emulator = emulatorFromBackend(backend, { cols: 80, rows: 24 })

    const thirtyLines = Array.from({ length: 30 }, (_, i) => `row ${i + 1}`).join("\r\n")
    await emulator.apply({ at: micros(1), type: "output", data: bytes(thirtyLines) })

    const s = backend.getScrollback()
    expect(emulator.scrollback).toBe(s.totalRows - s.screenRows)
    expect(emulator.scrollback).toBe(6)
    expect(emulator.getCell(emulator.scrollback, 4).char).toBe("7")

    backend.destroy()
  })

  test("a resize control event moves both the backend and the reported size", async () => {
    const backend = createXtermBackend()
    backend.init({ cols: 80, rows: 24 })
    const emulator = emulatorFromBackend(backend, { cols: 80, rows: 24 })

    await emulator.apply({ at: micros(1), type: "control", control: "resize", size: { cols: 120, rows: 40 } })

    expect(emulator.size).toEqual({ cols: 120, rows: 40 })
    expect(backend.getScrollback().screenRows).toBe(40)

    backend.destroy()
  })

  test("input does not paint — the program's echo is what reaches the screen", async () => {
    const backend = createXtermBackend()
    backend.init({ cols: 80, rows: 24 })
    const emulator = emulatorFromBackend(backend, FIXTURE_SIZE)

    await emulator.apply({ at: micros(1), type: "input", data: bytes("typed") })

    expect(emulator.getText().trim()).toBe("")

    backend.destroy()
  })

  // @failure An unexposed mode is serialized as disabled or omitted from the io picture.
  // @level l0
  // @consumer Emulator readers and recorded state comparisons.
  test("retains disabled and unexposed modes separately in the complete picture", () => {
    const backend = createXtermBackend()
    backend.init({ cols: 80, rows: 24 })
    const emulator = emulatorFromBackend(backend, FIXTURE_SIZE)

    const modes = emulator.modes
    expect(Object.keys(modes)).toHaveLength(15)
    expect(modes.applicationCursor).toBe(false)
    expect(modes.reverseVideo).toBeNull()
    expect(modes.altScroll).toBeNull()
    expect(modes.syncOutput).toBeNull()
    expect(modes.colorSchemeReporting).toBeNull()
    expect(modes.smoothScroll).toBeNull()

    backend.destroy()
  })

  // @failure A JS caller's unknown mode is fabricated as false by an adapter fallback.
  // @level l0
  // @consumer TerminalBackend callers crossing the untyped JS boundary.
  test.each([
    ["xtermjs", createXtermBackend],
    ["vterm", createVtermBackend],
    ["vt100", createVt100Backend],
    ["vt220", createVt220Backend],
  ] as const)("%s returns null for an unknown mode", (_name, create) => {
    const backend = create()
    backend.init({ cols: 20, rows: 4 })
    try {
      expect(backend.getMode("unknown-mode" as Mode)).toBeNull()
    } finally {
      backend.destroy()
    }
  })

  test("throws on a mode control event rather than dropping it", async () => {
    const backend = createXtermBackend()
    backend.init({ cols: 80, rows: 24 })
    const emulator = emulatorFromBackend(backend, FIXTURE_SIZE)

    expect(() =>
      emulator.apply({ at: micros(1), type: "control", control: "mode", mode: "altScreen", enabled: true }),
    ).toThrow(/cannot apply a mode control event/)

    backend.destroy()
  })
})

describe("IoEvent ⇄ Event", () => {
  test("round-trips an io-track row", () => {
    const row: IoEvent = { at: micros(1_234), direction: "out", data: "héllo ✓" }
    const event = eventFromIoEvent(row)

    expect(event).toMatchObject({ at: micros(1_234), type: "output" })
    expect(text(event.data)).toBe("héllo ✓")
    expect(ioEventFromEvent(event)).toEqual(row)
  })

  test("maps direction onto type in both directions", () => {
    expect(eventFromIoEvent({ at: micros(0), direction: "in", data: "q" }).type).toBe("input")
    expect(eventFromIoEvent({ at: micros(0), direction: "out", data: "q" }).type).toBe("output")
    expect(ioEventFromEvent({ at: micros(0), type: "input", data: bytes("q") })?.direction).toBe("in")
    expect(ioEventFromEvent({ at: micros(0), type: "output", data: bytes("q") })?.direction).toBe("out")
  })

  test("answers null for the events the io track cannot carry", () => {
    const unrepresentable: Event[] = [
      { at: micros(0), type: "control", control: "resize", size: FIXTURE_SIZE },
      { at: micros(1), type: "mark", name: "prompt" },
      { at: micros(2), type: "exit", code: 0, signal: null },
    ]

    for (const e of unrepresentable) expect(ioEventFromEvent(e)).toBeNull()
  })
})
