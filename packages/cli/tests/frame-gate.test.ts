import { describe, it, expect } from "vitest"
import { createFrameGate } from "../src/frame-gate.ts"

describe("createFrameGate — first-paint gate", () => {
  it("skips blank (whitespace-only) screens", () => {
    const gate = createFrameGate()
    expect(gate.observe("", false).capture).toBe(false)
    expect(gate.observe("   \n  \n", false).capture).toBe(false)
    expect(gate.observe("hello", false).capture).toBe(true)
  })

  it("fires resetPrior exactly once — on alt-screen entry", () => {
    const gate = createFrameGate()
    expect(gate.observe("banner", false).resetPrior).toBe(false)
    expect(gate.observe("banner", true).resetPrior).toBe(true) // entered
    expect(gate.observe("painting", true).resetPrior).toBe(false) // already in
    expect(gate.observe("more", true).resetPrior).toBe(false)
  })

  it("never fires resetPrior for a non-TUI command (no alt screen)", () => {
    const gate = createFrameGate()
    for (const text of ["line 1", "line 1\nline 2", "done"]) {
      expect(gate.observe(text, false).resetPrior).toBe(false)
    }
    expect(gate.enteredAltScreen()).toBe(false)
  })

  it("a TUI run: lead-in noise then alt-screen paint — frame 0 is post-paint", () => {
    const gate = createFrameGate()
    // Lead-in: shell echoes the command, interpreter starts — primary screen.
    const echo = gate.observe("$ bun km view ~/vault", false)
    expect(echo).toEqual({ capture: true, resetPrior: false })
    // The TUI takes over the alternate screen and paints.
    const paint = gate.observe("┌─ Vault ─┐\n│ board  │", true)
    // resetPrior tells the caller to discard the captured echo frame, so the
    // painted frame becomes frame 0.
    expect(paint).toEqual({ capture: true, resetPrior: true })
    expect(gate.enteredAltScreen()).toBe(true)
  })

  it("a blank alt-screen frame still does not capture (cleared, pre-paint)", () => {
    const gate = createFrameGate()
    // App enters alt screen but the buffer is momentarily cleared before paint.
    const cleared = gate.observe("   ", true)
    expect(cleared.resetPrior).toBe(true) // entry still resets prior noise
    expect(cleared.capture).toBe(false) // but a blank screen is not a frame
  })
})
