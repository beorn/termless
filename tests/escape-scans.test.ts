import { describe, expect, test } from "vitest"

import { scanMouseDecset, scanMouseDecsetTracking, scanWindowOpQueries } from "../src/terminal/escape-scans.ts"

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
