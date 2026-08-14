import { describe, expect, test } from "vitest"

import { createVtermBackend } from "../packages/vterm/src/backend.ts"
import {
  createOsc8PassthroughGate,
  scanMouseDecset,
  scanMouseDecsetTracking,
  scanWindowOpQueries,
  type Osc8DropReason,
} from "../src/terminal/escape-scans.ts"
import { createTerminal } from "../src/terminal/terminal.ts"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

function routeThroughOsc8Gate(input: string, options: { maxUriBytes?: number; oneByteChunks?: boolean } = {}) {
  const rawSink: Uint8Array[] = []
  const drops: Osc8DropReason[] = []
  const screenSink = createTerminal({ backend: createVtermBackend(), cols: 120, rows: 4 })
  const gate = createOsc8PassthroughGate({
    maxUriBytes: options.maxUriBytes,
    onData(data) {
      rawSink.push(data)
      screenSink.feed(data)
    },
    onDrop(reason) {
      drops.push(reason)
    },
  })
  const bytes = encoder.encode(input)
  if (options.oneByteChunks) {
    for (const byte of bytes) gate.push(Uint8Array.of(byte))
  } else {
    gate.push(bytes)
  }
  gate.end()
  const raw = decoder.decode(concatBytes(rawSink))
  const screen = screenSink.screen.getText().trimEnd()
  screenSink.close()
  return { raw, screen, drops }
}

describe("terminal escape scanners", () => {
  test("window-op scanner emits every supported query in order", () => {
    const seen: string[] = []
    scanWindowOpQueries(`pre\x1b[14tmid\x1b[18tpost\x1b[?996n`, (query) => seen.push(query))
    expect(seen).toEqual(["14t", "18t", "?996n"])
  })

  test("mouse DECSET scanner reports only the tracked toggles", () => {
    const seen: Array<[string, boolean]> = []
    scanMouseDecset(`\x1b[?1000h\x1b[?1002l\x1b[?1003h\x1b[?25h`, (param, on) => {
      seen.push([param, on])
    })
    expect(seen).toEqual([
      ["1000", true],
      ["1002", false],
      ["1003", true],
    ])
  })

  test("mouse DECSET tracking updates state and only reports meaningful changes", () => {
    const mouseModes = { m1000: false, m1002: false, m1003: false }
    let hits = 0

    scanMouseDecsetTracking("\x1b[?1000h\x1b[?1002l\x1b[?1003h", true, mouseModes, () => {
      hits++
    })

    expect(mouseModes).toEqual({ m1000: true, m1002: false, m1003: true })
    expect(hits).toBe(1)

    scanMouseDecsetTracking("\x1b[?25h", true, mouseModes, () => {
      hits++
    })

    expect(hits).toBe(1)
  })
})

describe("OSC 8 passthrough gate", () => {
  test.each([
    ["ST", "\x1b\\"],
    ["BEL", "\x07"],
  ])("passes %s-terminated hyperlinks byte-exactly across every chunk boundary", (_name, terminator) => {
    const input = `A\x1b]8;id=docs;https://example.com${terminator}link\x1b]8;;${terminator}B`
    const result = routeThroughOsc8Gate(input, { oneByteChunks: true })

    expect(result.raw).toBe(input)
    expect(result.screen).toBe("AlinkB")
    expect(result.drops).toEqual([])
  })

  test("passes non-OSC-8 bytes without interpreting them", () => {
    const input = "before\x1b]2;window title\x07after\x1b[31mred\x1b[0m"
    const result = routeThroughOsc8Gate(input, { oneByteChunks: true })

    expect(result.raw).toBe(input)
    expect(result.drops).toEqual([])
  })

  test.each(["before\x1b", "before\x1b]"])("preserves an incomplete non-OSC-8 prefix at EOF: %j", (input) => {
    const result = routeThroughOsc8Gate(input, { oneByteChunks: true })

    expect(result.raw).toBe(input)
    expect(result.drops).toEqual([])
  })

  test.each([
    {
      name: "missing URI separator",
      input: "before\x1b]8;id=badhttps://example.com\x07after",
      reason: "missing-uri-separator",
      expected: "beforeafter",
      maxUriBytes: undefined,
    },
    {
      name: "oversized URI",
      input: "before\x1b]8;;123456789\x07after",
      reason: "uri-too-long",
      expected: "beforeafter",
      maxUriBytes: 8,
    },
    {
      name: "interleaved C0",
      input: "before\x1b]8;;https://bad.example\x00tail\x07after",
      reason: "interleaved-control",
      expected: "beforeafter",
      maxUriBytes: undefined,
    },
    {
      name: "unterminated ST",
      input: "before\x1b]8;;https://bad.example",
      reason: "unterminated",
      expected: "before",
      maxUriBytes: undefined,
    },
  ] as const)("drops $name without corrupting either sink", ({ input, reason, expected, maxUriBytes }) => {
    const result = routeThroughOsc8Gate(input, { maxUriBytes, oneByteChunks: true })

    expect(result.raw).toBe(expected)
    expect(result.screen).toBe(expected)
    expect(result.raw).not.toContain("bad.example")
    expect(result.drops).toEqual([reason])
  })
})
