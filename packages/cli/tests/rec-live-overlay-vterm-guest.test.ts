/**
 * @failure  the live recording overlay renders through xtermGuest, so `termless
 *   rec` ships a different terminal emulator than every other production
 *   surface — silently, because both guests satisfy the same IslandGuest
 *   contract and the overlay looks correct either way
 * @level    l1 — static dependency assertion, no render pipeline
 * @consumer @si/vterm/21016-terminal-runtime — "vterm is the sole production
 *   shell guest"; @pm/22783-i15-workspace-usability Track 2 slice 2.
 *
 * WHY THIS IS A DEPENDENCY ASSERTION AND NOT A BEHAVIOURAL ONE. The two guests
 * are drop-in for each other by construction — identical option fields,
 * structurally identical child types, same IslandGuest contract. That is
 * exactly what makes the regression invisible: swapping back would keep every
 * behavioural test green. The only thing that distinguishes them from outside
 * is which module the overlay imports, so that is what gets pinned.
 *
 * The two guests are NOT interchangeable in what they report, which is the
 * point of the ruling: vterm reports real cursor shape and visibility, real
 * underline styles, and preserves content on narrowing reflow, where the xterm
 * adapter hardcodes, flattens, and truncates respectively (D3-D6 in
 * packages/vterm/tests/vterm-guest-differential.test.ts).
 *
 * A sibling test covers the fleet pane tool separately — a recording overlay
 * and a live agent pane are different surfaces, and one test passing would say
 * nothing about the other.
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const overlaySource = readFileSync(fileURLToPath(new URL("../src/rec-live-overlay.tsx", import.meta.url)), "utf8")

/** Import specifiers only — a mention inside a comment is not a dependency. */
function importedModules(source: string): string[] {
  return [...source.matchAll(/^\s*import\s[^"']*["']([^"']+)["']/gmu)].map((m) => m[1] ?? "")
}

describe("rec live overlay runs the production shell guest (@pm/22783 Track 2)", () => {
  test("imports @termless/vterm", () => {
    expect(importedModules(overlaySource)).toContain("@termless/vterm")
  })

  test("does NOT import @termless/xtermjs", () => {
    // Scoped to import specifiers on purpose: the file legitimately MENTIONS
    // xterm in prose — one deliberate contrast about the microtask flush, and
    // one historical note about the pre-Island Viewport shim. Neither is a
    // dependency, and a naive source-wide grep would fail on both.
    expect(importedModules(overlaySource)).not.toContain("@termless/xtermjs")
  })

  test("builds its guest with vtermGuest", () => {
    // Pins the call site, not just the import: an unused import would satisfy
    // the two assertions above while the overlay still constructed an xterm
    // guest from somewhere else.
    expect(overlaySource).toMatch(/\bvtermGuest\(/u)
    expect(overlaySource).not.toMatch(/\bxtermGuest\(/u)
  })
})
