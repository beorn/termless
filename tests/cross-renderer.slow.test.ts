/**
 * Cross-renderer invariant tests.
 *
 * These tests assert that the canvas + SVG paths (and optionally peekaboo)
 * agree on cell-grid dimensions when fed the same buffer state. The
 * matcher is the harness; this file pins the expected behavior on a
 * curated set of fixtures.
 *
 * Peekaboo is opt-in (set `PEEKABOO=1`) because it requires a macOS GUI
 * session, spawns real terminal windows, and is slow.
 */

import { describe, test, expect, beforeAll } from "vitest"
import { createTerminal, termlessMatchers } from "../src/index.ts"
import { createVt100Backend } from "../packages/vt100/src/index.ts"
import { existsSync } from "node:fs"

const ENABLE_PEEKABOO = process.env.PEEKABOO === "1"

beforeAll(() => {
  expect.extend(termlessMatchers as Parameters<typeof expect.extend>[0])
})

type CrossRendererAssertion = {
  toMatchAcrossRenderers: (options?: unknown) => Promise<void>
}

function asCrossRendererAssertion(term: unknown): CrossRendererAssertion {
  return expect(term) as unknown as CrossRendererAssertion
}

describe("toMatchAcrossRenderers", () => {
  test("plain text — canvas and SVG agree on cell-grid dimensions", async () => {
    const term = createTerminal({ backend: createVt100Backend(), cols: 40, rows: 6 })
    term.feed("Hello, world!\nLine two.\n")
    await asCrossRendererAssertion(term).toMatchAcrossRenderers({
      saveTo: "/tmp/cross-renderer-test/plain-text",
      dimensionTolerance: 0.01,
    })
    await term.close()
  }, 30_000)

  test("ANSI styles — canvas and SVG agree", async () => {
    const term = createTerminal({ backend: createVt100Backend(), cols: 40, rows: 8 })
    term.feed(
      "\x1b[1mbold\x1b[0m \x1b[3mitalic\x1b[0m \x1b[4munder\x1b[0m \x1b[7mrev\x1b[0m\n" +
        "\x1b[31mred\x1b[0m \x1b[32mgreen\x1b[0m \x1b[34mblue\x1b[0m\n" +
        "\x1b[38;2;255;128;64mtruecolor\x1b[0m\n",
    )
    await asCrossRendererAssertion(term).toMatchAcrossRenderers({
      saveTo: "/tmp/cross-renderer-test/ansi-styles",
      dimensionTolerance: 0.01,
    })
    await term.close()
  }, 30_000)

  test("box-drawing characters — canvas and SVG agree", async () => {
    const term = createTerminal({ backend: createVt100Backend(), cols: 30, rows: 8 })
    term.feed("┌─────────┐\n│  cell   │\n│  align  │\n└─────────┘\n")
    await asCrossRendererAssertion(term).toMatchAcrossRenderers({
      saveTo: "/tmp/cross-renderer-test/box-drawing",
      dimensionTolerance: 0.01,
    })
    await term.close()
  }, 30_000)

  // ── Peekaboo three-way (opt-in) ───────────────────────────────
  test.skipIf(!ENABLE_PEEKABOO)(
    "peekaboo three-way — canvas/svg/real-Ghostty agree",
    async () => {
      const term = createTerminal({ backend: createVt100Backend(), cols: 40, rows: 12 })
      const command = ["/bin/bash", "-c", `printf '\\x1b[H\\x1b[2J'; printf '\\x1b[1mhello\\x1b[0m\\n'; sleep 30`]
      term.feed("\x1b[H\x1b[2J\x1b[1mhello\x1b[0m\n")
      const FONT = "/Users/beorn/Library/Fonts/FiraMonoNerdFontMono-Regular.otf"
      const fontPath = existsSync(FONT) ? FONT : undefined
      await asCrossRendererAssertion(term).toMatchAcrossRenderers({
        command,
        saveTo: "/tmp/cross-renderer-test/peekaboo-three-way",
        includePeekaboo: true,
        peekabooApp: "ghostty",
        // Match the user's Ghostty config in the spawned window so all
        // three renderers paint with the same theme/font.
        ghosttyConfig: {
          theme: "Espresso",
          fontFamily: "FiraMono Nerd Font Mono",
          fontSize: 12,
        },
        cropChrome: true,
        dimensionTolerance: 0.2,
        ...(fontPath ? { fontPath } : {}),
        // Pass matching theme to canvas + SVG.
        theme: { background: "#323232", foreground: "#ffffff" },
      })
      await term.close()
    },
    120_000,
  )
})
