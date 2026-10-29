/**
 * @failure A reproduced kitty Window callback raises inside the headless bridge; kitty prints the trace and replays on, so
 * a reply the callback never sent reads as the engine's silence.
 * @level l5
 * @consumer Terminfo Kitty colour-query criteria and their DA1-sentinel negatives
 * @testonly none
 */
import { describe, expect, test } from "vitest"
import { createKittyBackend, isKittyAvailable } from "../src/backend.ts"

describe.skipIf(!isKittyAvailable())("kitty bridge callbacks", () => {
  // OSC 4 set and OSC 104 reset run kitty's own Window.set_color_table_color, which ends in Window.refresh.
  test("a colour table change replays without a callback error", () => {
    const backend = createKittyBackend()
    backend.init({ cols: 80, rows: 24 })
    try {
      backend.feed(new TextEncoder().encode("\x1b]4;1;#abcdef\x1b\\\x1b]104;1\x1b\\"))
      expect(() => backend.getCursor()).not.toThrow()
    } finally {
      backend.destroy()
    }
  })
})
