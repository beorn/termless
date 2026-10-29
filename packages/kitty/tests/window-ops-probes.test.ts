/**
 * Window-op probe responses — kitty backend.
 *
 * The kitty backend runs kitty's VT parser through a Python subprocess
 * (via batch replay) — it has no real window. We synthesize CSI 14t
 * (text-area pixel size) and CSI 18t (text-area cell count) responses
 * from configured grid × cell metrics. silvery's
 * `resolveMouseOption()` uses both to enable SGR-Pixels (1016) mouse
 * coordinate mode.
 *
 * See `tests/window-ops-probes.test.ts` at the termless root for the
 * full rationale.
 *
 * Note: tests are skipped automatically if kitty isn't installed (the
 * subprocess bridge requires `kitty +runpy` — see backend docs).
 */

import { describe, test, expect } from "vitest"
import { createKittyBackend, isKittyAvailable } from "../src/backend.ts"
import type { TerminalBackend } from "../../../src/terminal/types.ts"

const CSI_4_TEXT_AREA_PIXELS_RE = /^\x1b\[4;(\d+);(\d+)t$/
const CSI_8_TEXT_AREA_CELLS_RE = /^\x1b\[8;(\d+);(\d+)t$/

const kittyAvailable = isKittyAvailable()

async function probeBackend(backend: TerminalBackend, query: string): Promise<string[]> {
  backend.init?.({ cols: 80, rows: 24 })
  const responses: string[] = []
  backend.onResponse = (b: Uint8Array): void => {
    responses.push(new TextDecoder().decode(b))
  }
  backend.feed(new TextEncoder().encode(query))
  await new Promise<void>((r) => setTimeout(r, 50))
  return responses
}

function queryColor(backend: TerminalBackend, responses: string[], query: string, code: string): number[] {
  responses.length = 0
  backend.feed(new TextEncoder().encode(`\x1b]${query}\x1b\\`))
  backend.getCursor() // Force actual Kitty replay before observing its reply.
  const reply = responses.join("")
  const match = new RegExp(`^\x1b\\]${code};rgb:([0-9a-f]{4})/([0-9a-f]{4})/([0-9a-f]{4})\x1b\\\\$`, "i").exec(reply)
  if (!match) throw new Error(`Expected native OSC ${code} colour reply, got ${JSON.stringify(reply)}`)
  return match.slice(1).map((component) => Number.parseInt(component, 16))
}

describe.skipIf(!kittyAvailable)("window-op probe responses — kitty backend", () => {
  /**
   * @failure Missing colour callbacks suppress actual palette/dynamic replies, changes and reset effects.
   * @level l5
   * @consumer Terminfo Kitty colour-reset criteria
   */
  test.each([
    { name: "palette index0", query: "4;0;?", code: "4;0", set: "4;0", reset: "104;0" },
    { name: "foreground", query: "10;?", code: "10", set: "10", reset: "110" },
    { name: "background", query: "11;?", code: "11", set: "11", reset: "111" },
    { name: "cursor", query: "12;?", code: "12", set: "12", reset: "112" },
    { name: "selection background", query: "17;?", code: "17", set: "17", reset: "117" },
    { name: "selection foreground", query: "19;?", code: "19", set: "19", reset: "119" },
  ])("restores actual Kitty colour state: $name", ({ query, code, set, reset }) => {
    const backend = createKittyBackend()
    backend.init({ cols: 80, rows: 24 })
    const responses: string[] = []
    backend.onResponse = (bytes) => responses.push(new TextDecoder().decode(bytes))
    const feed = (value: string): void => backend.feed(new TextEncoder().encode(value))
    try {
      const baseline = queryColor(backend, responses, query, code)
      const changed = baseline.join() === [0x1212, 0x3434, 0x5656].join() ? [0x65, 0x43, 0x21] : [0x12, 0x34, 0x56]
      const rgb = changed.map((value) => value.toString(16).padStart(2, "0")).join("")
      feed(`\x1b]${set};#${rgb}\x1b\\`)
      expect(queryColor(backend, responses, query, code)).toEqual(changed.map((value) => value * 257))
      feed(`\x1b]${reset}\x1b\\`)
      expect(queryColor(backend, responses, query, code)).toEqual(baseline)

      if (code === "4;0") {
        // The same callback also receives paired entries and whole-table reset.
        feed(`\x1b]4;0;#${rgb};1;#abcdef\x1b\\`)
        expect(queryColor(backend, responses, query, code)).toEqual(changed.map((value) => value * 257))
        feed("\x1b]104\x1b\\")
        expect(queryColor(backend, responses, query, code)).toEqual(baseline)
      } else if (code === "10") {
        // Kitty's own Window.set_dynamic_color answers sequential parameters only for its dynamic colour codes
        // (10/11/12/17/19), then OSC 17/19 and the OSC 22 pointer-shape query.
        responses.length = 0
        feed(`\x1b]10;${Array(10).fill("?").join(";")}\x1b\\\x1b]17;?\x1b\\\x1b]19;?\x1b\\\x1b]22;?\x1b\\`)
        backend.getCursor()
        expect([...responses.join("").matchAll(/\x1b\](\d+);/g)].map((match) => match[1])).toEqual([
          "10",
          "11",
          "12",
          "17",
          "19",
          "17",
          "19",
          "22",
        ])
      }
    } finally {
      backend.destroy()
    }
  })

  /**
   * @failure Missing OSC10 prerequisite readback hides native colour-stack push/pop effects.
   * @level l5
   * @consumer Terminfo Kitty OSC30001 and OSC30101 criteria
   */
  test("restores actual Kitty colour state: paired native stack push/pop", () => {
    const backend = createKittyBackend()
    backend.init({ cols: 80, rows: 24 })
    const responses: string[] = []
    backend.onResponse = (bytes) => responses.push(new TextDecoder().decode(bytes))
    const feed = (value: string): void => backend.feed(new TextEncoder().encode(value))
    try {
      const baseline = queryColor(backend, responses, "10;?", "10")
      const changed = baseline.join() === [0x1212, 0x3434, 0x5656].join() ? [0x65, 0x43, 0x21] : [0x12, 0x34, 0x56]
      const rgb = changed.map((value) => value.toString(16).padStart(2, "0")).join("")
      feed(`\x1b]30001\x1b\\\x1b]10;#${rgb}\x1b\\`)
      expect(queryColor(backend, responses, "10;?", "10")).toEqual(changed.map((value) => value * 257))
      feed("\x1b]30101\x1b\\")
      expect(queryColor(backend, responses, "10;?", "10")).toEqual(baseline)
    } finally {
      backend.destroy()
    }
  })

  /**
   * @failure Kitty batch replay redelivers previous query replies as if they belonged to a later feed.
   * @level l2
   * @consumer Terminfo headless device and mode queries
   */
  test("delivers only each feed's new reply, including after reset", () => {
    const backend = createKittyBackend()
    backend.init({ cols: 80, rows: 24 })
    const responses: string[] = []
    backend.onResponse = (bytes) => responses.push(new TextDecoder().decode(bytes))
    const feed = (sequence: string): void => backend.feed(new TextEncoder().encode(sequence))

    feed("\x1b[6n")
    backend.getCursor() // Kitty's lazy batch replay delivers the pending reply.
    expect(responses.join("")).toBe("\x1b[1;1R")

    responses.length = 0
    feed("\x1b[6n")
    backend.getCursor()
    expect(responses.join("")).toBe("\x1b[1;1R")

    responses.length = 0
    backend.reset()
    backend.getCursor()
    expect(responses).toEqual([])

    feed("\x1b[6n")
    backend.getCursor()
    expect(responses.join("")).toBe("\x1b[1;1R")
    backend.destroy()
  })

  /**
   * @failure A response generated without a listener leaks into the next scoped capture.
   * @level l2
   * @consumer Terminfo headless query capture
   */
  test("consumes replies observed in a snapshot without a listener", () => {
    const backend = createKittyBackend()
    backend.init({ cols: 80, rows: 24 })
    const feed = (sequence: string): void => backend.feed(new TextEncoder().encode(sequence))
    feed("\x1b[6n")
    backend.getCursor()

    const responses: string[] = []
    backend.onResponse = (bytes) => responses.push(new TextDecoder().decode(bytes))
    feed("\x1b[6n")
    backend.getCursor()
    expect(responses.join("")).toBe("\x1b[1;1R")
    backend.destroy()
  })

  test("does not synthesize positive-pixel CSI 14t/16t responses in headless bridge", () => {
    const backend = createKittyBackend()
    backend.init({ cols: 80, rows: 24 })
    const responses: string[] = []
    backend.onResponse = (bytes) => responses.push(new TextDecoder().decode(bytes))
    backend.feed(new TextEncoder().encode("\x1b[14t\x1b[16t"))
    expect(responses, "feed() must not synthesize 14t before bridge replay").toEqual([])
    backend.getCursor()
    expect(responses.join("")).toBe("\x1b[4;0;0t\x1b[6;0;0t")
    backend.destroy()
  })

  test("answers CSI 18t from Kitty's Screen engine on snapshot replay without adapter mirror duplication", () => {
    const backend = createKittyBackend()
    backend.init({ cols: 80, rows: 24 })
    const responses: string[] = []
    backend.onResponse = (bytes) => responses.push(new TextDecoder().decode(bytes))
    backend.feed(new TextEncoder().encode("\x1b[18t"))
    expect(responses, "feed() must not synthesize 18t from the adapter mirror").toEqual([])
    backend.getCursor()
    expect(responses.join("")).toBe("\x1b[8;24;80t")
    backend.destroy()
  })

  test("returns null from getMode for modes not exposed by Kitty's Python Screen API and forwards DECRPM", () => {
    const backend = createKittyBackend()
    backend.init({ cols: 80, rows: 24 })
    const responses: string[] = []
    backend.onResponse = (bytes) => responses.push(new TextDecoder().decode(bytes))
    backend.feed(new TextEncoder().encode("\x1b[?1000h\x1b[?1000$p\x1b[?1003h\x1b[?1003$p\x1b[?1006h\x1b[?1006$p"))
    expect(backend.getMode("altScreen")).toBe(false)
    expect(backend.getMode("cursorVisible")).toBe(true)
    expect(backend.getMode("autoWrap")).toBeNull()
    expect(backend.getMode("mouseTracking")).toBeNull()
    expect(backend.getMode("reverseVideo")).toBeNull()
    expect(backend.getMode("applicationKeypad")).toBeNull()
    expect(backend.getMode("originMode")).toBeNull()
    expect(backend.getMode("insertMode")).toBeNull()
    expect(backend.getMode("sgrMouse" as never)).toBeNull()
    expect(responses.join("")).toBe("\x1b[?1000;1$y\x1b[?1003;1$y\x1b[?1006;1$y")
    backend.destroy()
  })

  /**
   * @failure Headless Kitty drops its title-stack callback and reports XTWINOPS 22/23 unsupported.
   * @level l2
   * @consumer Terminfo headless window-title probes
   */
  test("tracks Kitty's title-only stack with its ten-entry limit", () => {
    const backend = createKittyBackend()
    backend.init?.({ cols: 80, rows: 24 })
    const feed = (sequence: string): void => backend.feed(new TextEncoder().encode(sequence))

    feed("\x1b]2;original\x07\x1b[22;0t\x1b]2;changed\x07")
    expect(backend.getTitle()).toBe("changed")
    feed("\x1b[23;0t")
    expect(backend.getTitle()).toBe("original")

    // Kitty's icon-only form must not save or restore the visible title.
    feed("\x1b[22;1t\x1b]2;icon-only\x07\x1b[23;1t")
    expect(backend.getTitle()).toBe("icon-only")

    // Kitty's window keeps at most ten saved titles; the oldest falls off.
    for (let i = 0; i < 11; i++) feed(`\x1b[22;2t\x1b]2;title-${i}\x07`)
    for (let i = 0; i < 11; i++) feed("\x1b[23;2t")
    expect(backend.getTitle()).toBe("title-0")
  })

  /**
   * @failure Headless Kitty swallows its on_da1 window callback, so DA1 goes unanswered and the DA1 sentinel cannot decide a silent query.
   * @level l2
   * @consumer Terminfo headless DA1 sentinel and device.primary-da
   */
  test("answers primary DA the way Kitty's window does", () => {
    const backend = createKittyBackend()
    backend.init?.({ cols: 80, rows: 24 })
    const responses: string[] = []
    backend.onResponse = (bytes) => responses.push(new TextDecoder().decode(bytes))
    backend.feed(new TextEncoder().encode("\x1b[c"))
    backend.getCursor()
    // Kitty's Window.on_da1 sends CSI followed by da1(options); with default options that is ?62;52;c.
    expect(responses.join("")).toBe("\x1b[?62;52;c")
    backend.destroy()
  })
})

describe.skipIf(kittyAvailable)("window-op probe responses — kitty backend (skipped)", () => {
  test.skip("kitty binary not found — install via `brew install --cask kitty`", () => {})
})
