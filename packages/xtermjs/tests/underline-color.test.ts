/**
 * @failure Indexed SGR 58 is decoded as RGB 0x000005 instead of palette color 5.
 * @level l1
 * @consumer Termless cell snapshots and terminfo headless SGR observations
 * @testonly none
 */
import { expect, test } from "vitest"
import { createXtermBackend } from "../src/backend.ts"

test("decodes indexed and RGB underline colors from their encoded xterm modes", () => {
  const backend = createXtermBackend({ cols: 80, rows: 24 })
  try {
    backend.feed(new TextEncoder().encode("\x1b[4;38;5;5;58;5;5mI\x1b[58;2;255;0;128mR"))

    const indexed = backend.getCell(0, 0)
    expect(indexed.char).toBe("I")
    expect(indexed.underlineColor).toEqual(indexed.fg)
    expect(indexed.underlineColor).toEqual({ r: 128, g: 0, b: 128 })

    expect(backend.getCell(0, 1).underlineColor).toEqual({ r: 255, g: 0, b: 128 })
  } finally {
    backend.destroy()
  }
})
