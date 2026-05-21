/**
 * Unit tests for the {@link RecorderLive} live-chrome overlay.
 *
 * Mounts the component against a synthetic headless terminal and asserts:
 *   (a) chrome frame characters are present (or absent for `--live-chrome none`)
 *   (b) the cell grid is centered inside the host terminal
 *   (c) inner content renders correctly — including a TUI-style absolute-cursor
 *       paint (`\x1b[H`) that must NOT escape the frame
 *
 * No PTY / no live host UI — the test feeds bytes into a headless terminal
 * directly and renders the React overlay to a string.
 */

// MUST be the first import — installs an `AsyncDisposableStack` global stub
// for Node 22 (vitest's default runtime), which is required for silvery's
// `@silvery/scope` module to evaluate. Bun's runtime has it natively.
import "./_polyfill-async-disposable-stack.ts"

import { describe, it, expect } from "vitest"
import React from "react"
import { renderString } from "silvery"
import { createTerminal } from "../../../src/terminal/terminal.ts"
import { createVtermBackend } from "../../vterm/src/index.ts"
import { RecorderLive } from "../src/rec-live-view.tsx"

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex -- ANSI-stripping by design
  return s.replace(/\x1b\[[0-9;]*m/g, "")
}

/** Create a synthetic 20×6 headless terminal, feed it `text`, and return it. */
function makeTerminal(text: string): ReturnType<typeof createTerminal> {
  const backend = createVtermBackend()
  const term = createTerminal({ backend, cols: 20, rows: 6 })
  if (text) term.feed(text)
  return term
}

describe("RecorderLive", () => {
  it("chrome=macos renders a frame around the cell grid (round border + title bar)", async () => {
    const term = makeTerminal("HELLO RECORDER")

    const output = await renderString(
      React.createElement(RecorderLive, {
        terminal: term,
        chromeStyle: "macos",
        title: "demo",
      }),
      { width: 60, height: 14 },
    )
    const plain = stripAnsi(output)

    // (a) Frame chars present — round border uses ╭ ╮ ╰ ╯ corner glyphs.
    const hasRoundBorder = /[╭╮╰╯]/.test(plain) || /[┌┐└┘]/.test(plain)
    expect(hasRoundBorder).toBe(true)
    // Title from the chrome bar is rendered above the grid.
    expect(plain).toContain("demo")
    // Inner content renders inside the frame.
    expect(plain).toContain("HELLO RECORDER")

    term.close()
  })

  it("inner content is centered horizontally — leading whitespace before the frame", async () => {
    const term = makeTerminal("CENTERED")

    const output = await renderString(
      React.createElement(RecorderLive, {
        terminal: term,
        chromeStyle: "macos",
        title: "",
      }),
      { width: 60, height: 14 },
    )
    const plain = stripAnsi(output)
    const lines = plain.split("\n")

    // Find the row that holds the top-left border corner glyph.
    const topBorderLine = lines.find((l) => /[╭┌]/.test(l))
    expect(topBorderLine).toBeDefined()

    if (topBorderLine) {
      // Leading whitespace before the border corner — the centering primitive
      // (`alignItems="center"` on the outer Box) must produce visible left
      // padding on a 60-col host with a 20-col inner grid.
      const cornerIdx = topBorderLine.search(/[╭┌]/)
      expect(cornerIdx).toBeGreaterThan(0)
    }

    term.close()
  })

  it("absolute-cursor escape (\\x1b[H) feed stays INSIDE the frame", async () => {
    // A TUI program writes `\x1b[H` (cursor home) + content. If the bytes were
    // piped raw to the host, that home-position paint would land at the host
    // top-left — outside the frame. RecorderLive renders the headless cell
    // grid, so the paint must stay inside the 20×6 inner region.
    const term = makeTerminal("\x1b[Houtside?\x1b[2;1Hrow2 here")

    const output = await renderString(
      React.createElement(RecorderLive, {
        terminal: term,
        chromeStyle: "macos",
        title: "vim",
      }),
      { width: 60, height: 14 },
    )
    const plain = stripAnsi(output)
    const lines = plain.split("\n")

    // The frame's top-border row must NOT contain the program's text — those
    // bytes landed in the headless terminal at (0,0), which is inside the
    // frame.
    const topBorderLine = lines.find((l) => /[╭┌]/.test(l))
    expect(topBorderLine).toBeDefined()
    expect(topBorderLine ?? "").not.toContain("outside?")
    expect(topBorderLine ?? "").not.toContain("row2")

    // The grid's content must be present somewhere in the rendered output
    // (i.e. inside the frame).
    expect(plain).toContain("outside?")
    expect(plain).toContain("row2 here")

    // Frame chars must still be intact — escape didn't bleed.
    const cornerCount = (plain.match(/[╭╮╰╯┌┐└┘]/g) ?? []).length
    expect(cornerCount).toBeGreaterThanOrEqual(2)

    term.close()
  })

  it("chrome=none omits the border (raw cell-grid passthrough)", async () => {
    const term = makeTerminal("NO FRAME")

    const output = await renderString(
      React.createElement(RecorderLive, {
        terminal: term,
        chromeStyle: "none",
        title: "",
      }),
      { width: 60, height: 14 },
    )
    const plain = stripAnsi(output)

    // No round-border or single-border corner glyphs.
    expect(/[╭╮╰╯]/.test(plain)).toBe(false)
    expect(/[┌┐└┘]/.test(plain)).toBe(false)
    // Content still renders.
    expect(plain).toContain("NO FRAME")

    term.close()
  })
})
