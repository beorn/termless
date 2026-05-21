/**
 * `.tape` ⇄ `Recording` compiler / codegen tests.
 *
 * Phase 2 of the Recording-domain unification — proves the in-memory
 * `Recording` can represent a `.tape` scenario via the `commands` track.
 * `.tape` is a *compiler input*, not a symmetric codec: the round-trip is
 * lossy, and these tests pin exactly what survives it.
 */

import { describe, test, expect } from "vitest"
import { parseTape } from "../../src/tape/parser.ts"
import { compileTape, compileTapeSource } from "../../src/tape/compile.ts"
import { generateTape } from "../../src/tape/codegen.ts"

const SAMPLE = `
# a sample tape
Output demo.gif
Set Width 100
Set Height 30
Set FontSize 14
Type "hello world"
Enter
Sleep 2s
Ctrl+c
Screenshot shot.png
`

describe("compileTape — .tape → Recording (commands track)", () => {
  test("compiles directives into a commands track", () => {
    const { recording } = compileTapeSource(SAMPLE)
    expect(recording.commands).toBeDefined()
    const kinds = recording.commands!.map((c) => c.kind)
    expect(kinds).toContain("type")
    expect(kinds).toContain("key")
    expect(kinds).toContain("sleep")
    expect(kinds).toContain("ctrl")
    expect(kinds).toContain("screenshot")
    // io / frames are absent — a hand-authored tape is intent-only.
    expect(recording.io).toBeUndefined()
    expect(recording.frames).toBeUndefined()
  })

  test("Set Width/Height seed recording dimensions", () => {
    const { recording } = compileTapeSource(SAMPLE)
    expect(recording.cols).toBe(100)
    expect(recording.rows).toBe(30)
  })

  test("Screenshot compiles to a screenshot command, NOT a frame", () => {
    const { recording } = compileTapeSource(SAMPLE)
    const shot = recording.commands!.find((c) => c.kind === "screenshot")
    expect(shot).toBeDefined()
    expect(shot).toMatchObject({ kind: "screenshot", path: "shot.png" })
    expect(recording.frames).toBeUndefined()
  })

  test("non-commands directives are dropped and surfaced", () => {
    const { dropped } = compileTapeSource(SAMPLE)
    expect(dropped.map((d) => d.type)).toEqual(["output"])
  })

  test("Sleep advances the virtual clock; duration reflects it", () => {
    const { recording } = compileTapeSource(SAMPLE)
    // Sleep 2s = 2_000_000µs, plus typing time for "hello world".
    expect(recording.durationMicros).toBeGreaterThanOrEqual(2_000_000)
    const sleep = recording.commands!.find((c) => c.kind === "sleep")
    expect(sleep).toMatchObject({ kind: "sleep", durationMicros: 2_000_000 })
  })

  test("commands carry monotonically non-decreasing timestamps", () => {
    const { recording } = compileTapeSource(SAMPLE)
    let prev = -1
    for (const cmd of recording.commands!) {
      expect(cmd.at).toBeGreaterThanOrEqual(prev)
      prev = cmd.at
    }
  })
})

describe("generateTape — Recording → .tape (lossy codegen)", () => {
  test("round-trips a tape's commands through Recording (lossy — kinds + payloads survive)", () => {
    const { recording } = compileTapeSource(SAMPLE)
    const regenerated = generateTape(recording)
    const reparsed = parseTape(regenerated)
    const { recording: recording2 } = compileTape(reparsed)
    // Dimensions survive the round-trip exactly.
    expect(recording2.cols).toBe(recording.cols)
    expect(recording2.rows).toBe(recording.rows)
    // The load-bearing payloads survive: the Type text, the key, the ctrl,
    // the screenshot path. (.tape codegen is lossy on exact command sequence
    // — resize lowers to two Set lines, long gaps synthesize Sleeps — so we
    // assert payload preservation, not sequence identity.)
    const typed = recording2.commands!.find((c) => c.kind === "type")
    expect(typed).toMatchObject({ kind: "type", text: "hello world" })
    expect(recording2.commands!.some((c) => c.kind === "ctrl" && c.key === "c")).toBe(true)
    const shot = recording2.commands!.find((c) => c.kind === "screenshot")
    expect(shot).toMatchObject({ kind: "screenshot", path: "shot.png" })
  })

  test("preserves Type text and key directives byte-for-byte in generated tape", () => {
    const { recording } = compileTapeSource('Type "echo hi"\nEnter\n')
    const tape = generateTape(recording, { emitDimensions: false })
    // Default-speed Type emits a bare `Type` (no `@speed`) — the default
    // cadence is not authored intent.
    expect(tape).toContain('Type "echo hi"')
    expect(tape).toContain("Enter")
  })

  test("throws for a recording with no commands track", () => {
    // A fabricated io-only recording has no intent to codegen.
    const ioOnly = {
      version: 1 as const,
      cols: 80,
      rows: 24,
      durationMicros: 0 as never,
      io: [{ at: 0 as never, direction: "out" as const, data: "x" }],
      provenance: { reproducible: true },
    }
    expect(() => generateTape(ioOnly)).toThrow(/no commands track/)
  })
})
