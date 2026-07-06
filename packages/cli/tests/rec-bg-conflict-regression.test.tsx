/**
 * Regression — `termless rec` <Terminal> overlay vs. real km-view ANSI.
 *
 * The `rec-live-overlay` re-encodes a captured terminal's cell grid through
 * silvery's `<Terminal>` component. silvery's render pipeline enforces
 * background coherence: when ANSI bg in text content layers over a silvery
 * `backgroundColor`, it `throw`s a "Background conflict" by default — the
 * right safety net for a silvery app's own pipeline bugs.
 *
 * But a `<Terminal>` mirroring arbitrary EXTERNAL ANSI *expects* bg
 * conflicts — chalk-styled status bars and selection highlights are
 * conflict-rich by nature. The `<Terminal>`-based rec-live-overlay crashed
 * `termless rec` for any real TUI:
 *
 *   [silvery] Background conflict at (1,3): chalk bg=#c5cbd7 on silvery
 *   bufferBg=rgb(46,52,64). Text: " 📁  ". …
 *
 * The fix (silvery): `<Terminal>` sets `bgConflict="ignore"` on the `<Text>`
 * rows it paints, opting its external-ANSI cells out of the throw while the
 * global throw stays a safety net everywhere else.
 *
 * This test is deliberately NON-SYNTHETIC. The original `<Terminal>` tests
 * passed because they used hand-built fake grids; only real `km view` ANSI
 * (chalk bg + framework-emitted padding) hit the conflict. The fixture
 * `fixtures/km-view-160x50.ansi` is a raw PTY capture of
 * `km view <vault>` (the km TUI) at 160×50 — it is parsed by a
 * real terminal backend at test time, not a pre-baked cell grid.
 *
 * Pairs with `vendor/silvery/tests/features/terminal-bg-conflict.test.tsx`
 * (the silvery-side STRICT test) and bead
 * `@km/code/15551-termless-rec-bg-conflict-crash`.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import React from "react"
import { describe, expect, test } from "vitest"
import { createRenderer } from "@silvery/test"
import { Box, Terminal, Text, type TerminalReadable } from "silvery"
import { createTerminal } from "../../../src/terminal/terminal.ts"
import { createXtermBackend } from "../../xtermjs/src/backend.ts"

const COLS = 160
const ROWS = 50

/**
 * Parse the real km-view ANSI capture into a live terminal grid. The
 * returned object satisfies silvery's duck-typed `TerminalReadable` — a
 * termless `Terminal` already exposes `cols`/`rows`/`getLines()`/
 * `getCursor()` with cell shapes that match silvery's `TerminalCell`.
 */
function kmViewGrid(): TerminalReadable {
  const raw = readFileSync(join(import.meta.dirname, "fixtures", "km-view-160x50.ansi"))
  // xterm.js — a pure-JS backend that parses ANSI in any JS environment
  // (no WASM, no browser globals). The conformance suite proves it produces
  // the same cell grid as the ghostty backend `termless rec` uses live.
  const term = createTerminal({ backend: createXtermBackend(), cols: COLS, rows: ROWS })
  term.feed(new Uint8Array(raw))
  return {
    cols: COLS,
    rows: ROWS,
    // termless `getLines()` returns the whole buffer; <Terminal> slices the
    // trailing `rows`. The cell objects are structurally compatible.
    getLines: () => term.getLines() as unknown as ReturnType<TerminalReadable["getLines"]>,
    getCursor: () => {
      const c = term.getCursor()
      return { x: c.x, y: c.y, visible: c.visible !== false }
    },
  }
}

describe("rec-live-overlay — <Terminal> vs. real km-view ANSI", () => {
  test("the captured grid is genuinely conflict-rich (test pre-condition)", async () => {
    // Guard: if a future km-view restyle stops emitting chalk bg, this test
    // would silently stop exercising the conflict path. Assert the fixture
    // still carries bg-styled content cells.
    const grid = kmViewGrid()
    let bgContentCells = 0
    for (const row of grid.getLines()) {
      for (const cell of row) {
        if (cell.bg != null && (cell.char ?? " ").trim() !== "") bgContentCells++
      }
    }
    expect(bgContentCells).toBeGreaterThan(0)
  })

  test("<Terminal> renders real km-view ANSI inside a bg Box WITHOUT throwing", async () => {
    const grid = kmViewGrid()
    const render = createRenderer({ cols: COLS + 4, rows: ROWS + 4 })
    // The `<Box backgroundColor>` is the conflict trigger: it seeds a
    // silvery buffer bg under the cells <Terminal> paints. This mirrors the
    // rec-live-overlay's framed chrome (a bg-styled Box wrapping the grid).
    expect(() =>
      render(
        <Box backgroundColor="#1e222a" padding={1}>
          <Terminal terminal={grid} />
        </Box>,
      ),
    ).not.toThrow()
  })

  test("control: the SAME grid via plain <Text> (no bgConflict opt-out) DOES throw", async () => {
    // Proves the test genuinely exercises the bg-conflict code path — and
    // that the global throw is still a live safety net for silvery-app bugs.
    // <Terminal> encodes each row to ANSI and paints it via <Text>; doing
    // that by hand WITHOUT `bgConflict="ignore"` reproduces the original
    // regression.
    const { encodeTerminalRow } = await import("silvery")
    const grid = kmViewGrid()
    const lines = grid.getLines()
    const sliceStart = Math.max(0, lines.length - ROWS)
    const rowStrings = lines.slice(sliceStart).map((row) => encodeTerminalRow(row as never, COLS))
    const render = createRenderer({ cols: COLS + 4, rows: ROWS + 4 })
    expect(() =>
      render(
        <Box backgroundColor="#1e222a" padding={1} flexDirection="column">
          {rowStrings.map((line, r) => (
            // eslint-disable-next-line react/no-array-index-key
            <Text key={r}>{line}</Text>
          ))}
        </Box>,
      ),
    ).toThrow(/Background conflict/)
  })

  test('<Terminal>\'s own rows opt out via bgConflict="ignore"', async () => {
    // Same grid, same bg Box — but routed through <Terminal>, which sets
    // `bgConflict="ignore"` on each <Text> row. The opt-out is scoped: only
    // the cells <Terminal> paints are exempt.
    const grid = kmViewGrid()
    const render = createRenderer({ cols: COLS + 4, rows: ROWS + 4 })
    const app = render(
      <Box backgroundColor="#1e222a" padding={1}>
        <Terminal terminal={grid} />
      </Box>,
    )
    // The km-view chrome rendered — sanity-check the grid produced output.
    expect(app.text.length).toBeGreaterThan(0)
  })
})
