import { describe, test, expect } from "vitest"
import { createXtermBackend } from "../src/backend.ts"

/**
 * Regression: the headless xterm.js backend must clamp alt-screen rows to the
 * new width when width SHRINKS, matching real terminals + ghostty-native, which
 * truncate the alt grid on shrink.
 *
 * Without the clamp, a full-width *styled* row (e.g. a black-bg fill painted by
 * a fullscreen TUI) keeps its over-wide cells after `resize(narrower)`. The
 * styled trailing cells are NOT trimmed by `translateToString(true)`, so the row
 * reports a width greater than `cols` forever — which makes silvery's
 * `waitNoOverflow` resize assertion time out (the `dogfood-19738` slow test).
 * The fix belongs here (test-emulator fidelity), not in silvery's output phase:
 * the only escape that clears the residue is `\x1b[2J`, which the 20297
 * pane-flicker fix deliberately removed from resize frames.
 *
 * Bead: 20335-altscreen-shrink-clamp.
 */
describe("alt-screen resize clamp on width-shrink (20335)", () => {
  /** Enter the alt screen and paint row 0 full-width with a black-bg fill. */
  function paintFullWidthStyledRow(backend: ReturnType<typeof createXtermBackend>, width: number): void {
    // \x1b[?1049h = enter alt screen; \x1b[H = home; \x1b[40m = black bg;
    // then `width` spaces fill row 0 with styled (non-null) cells.
    backend.feed(new TextEncoder().encode(`\x1b[?1049h\x1b[H\x1b[40m${" ".repeat(width)}\x1b[0m`))
  }

  test("a full-width styled alt-screen row is clamped to the new width on shrink", () => {
    const backend = createXtermBackend({ cols: 140, rows: 5 })
    paintFullWidthStyledRow(backend, 140)

    // Pre-condition (documents the bug surface): the styled row is full width.
    expect(backend.getText().split("\n")[0]?.length).toBe(140)

    // Shrink 140 → 120.
    backend.resize(120, 5)

    // Every row must now be within the new width — no styled residue past 120.
    for (const row of backend.getText().split("\n")) {
      expect(row.length).toBeLessThanOrEqual(120)
    }
    backend.destroy()
  })

  test("growth and equal-width resizes leave rows untouched (clamp is shrink-only)", () => {
    const backend = createXtermBackend({ cols: 100, rows: 5 })
    paintFullWidthStyledRow(backend, 100)

    // Grow — the styled row stays as wide as it was (no truncation on growth).
    backend.resize(120, 5)
    expect(backend.getText().split("\n")[0]?.length).toBe(100)

    backend.destroy()
  })

  test("the normal (non-alt) buffer still resizes correctly", () => {
    const backend = createXtermBackend({ cols: 140, rows: 5 })
    // No alt screen — plain styled fill on the normal buffer.
    backend.feed(new TextEncoder().encode(`\x1b[H\x1b[40m${" ".repeat(140)}\x1b[0m`))
    backend.resize(120, 5)
    for (const row of backend.getText().split("\n")) {
      expect(row.length).toBeLessThanOrEqual(120)
    }
    backend.destroy()
  })
})
