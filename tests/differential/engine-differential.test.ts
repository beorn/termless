/**
 * @failure  the vterm.js guest silently diverges further from the xterm.js
 *           reference than the recorded baseline — the guest-swap default gate
 *           would ship a terminal engine that renders SGR / wide clusters /
 *           region-scroll / OSC 8 / tab stops differently from the reference,
 *           corrupting restored panes without any test going red
 * @level    l1 - two in-memory emulator backends compared across their read
 *           contract (no process, PTY, DB, or filesystem)
 * @consumer @si/vterm/21016-terminal-runtime — differential baseline that seeds
 *           the vterm-guest default-swap gate
 */

import { describe, test, expect } from "vitest"
import { runEngineDifferential } from "./runner.ts"
import { CORPUS } from "./corpus.ts"

// ═══════════════════════════════════════════════════════════════════════════
// Recorded divergence baseline — UPDATE CONSCIOUSLY.
//
// Each number is the MEASURED count of diverging cells between the xterm.js
// reference (old) and the vterm.js guest (new) for that stream. This is NOT a
// target of zero: the two engines legitimately disagree on some surfaces, and
// this table records exactly how much, at the time of writing.
//
// The gate below fails if a stream diverges MORE than its recorded number (a
// guest regression). If a stream diverges LESS, the guest converged toward the
// reference — the collection-time summary prints "IMPROVED" and you lower the
// number here. Either direction is a conscious edit; there is no silent slack.
//
// The trailing comment on every non-zero entry names the visible symptom.
// ═══════════════════════════════════════════════════════════════════════════
const BASELINE: Record<string, number> = {
  "plain-ascii": 0,
  "sgr-storm": 0,
  "cr-overwrite": 0,
  // xterm segments the ZWJ family 👨‍👩‍👧‍👦 across 4 wide cells and treats VS16
  // ❤️/☀️ as wide (shifting following cells); vterm keeps the family as one
  // cluster in a single cell and widths the VS16 glyphs differently.
  "wide-cjk-emoji": 13,
  "alt-screen-roundtrip": 0,
  "margins-region-scroll": 0,
  "wrap-pending": 0,
  // xterm.js decorates OSC 8 hyperlink cells with a dashed underline; vterm
  // leaves the linked runs ("LINKED", "IDLINK") with no underline.
  "osc8-links": 12,
  "cursor-style": 0,
  "tabs": 0,
}

const results = runEngineDifferential(CORPUS)

// Collection-time diagnostics. The km vitest setup throws on console output
// produced *inside a test*, so the full formatted summary is emitted here at
// describe/collection scope instead — it prints when the file runs and never
// trips the in-test console guard.
{
  const lines: string[] = ["", "══ engine differential: vterm guest vs xterm reference ══"]
  for (const r of results) {
    const base = BASELINE[r.name] ?? Number.NaN
    const status =
      r.diffCount > base ? "REGRESSED" : r.diffCount < base ? "IMPROVED" : "ok"
    lines.push(
      `  ${r.name.padEnd(22)} diff=${String(r.diffCount).padStart(3)} baseline=${String(base).padStart(3)} [${status}]`,
    )
  }
  lines.push("", "── per-stream formatted diffs ──")
  for (const r of results) {
    lines.push(`\n─── ${r.name} — diffCount=${r.diffCount} ───\n${r.formatted}`)
  }
  console.log(lines.join("\n"))
}

describe("engine differential: vterm guest vs xterm reference", () => {
  test("runner mechanics: one result per stream, both engines consumed each", () => {
    // Non-empty results, exactly one per corpus stream.
    expect(results.length).toBe(CORPUS.length)
    expect(results.map((r) => r.name).sort()).toEqual(CORPUS.map((s) => s.name).sort())

    // Every result is well-formed. runEngineDifferential throws loudly if either
    // engine fails to consume a stream (runner.ts § NO SILENT ERRORS), so a
    // well-formed result set is proof both engines ran every stream.
    for (const r of results) {
      expect(typeof r.diffCount).toBe("number")
      expect(r.diffCount).toBeGreaterThanOrEqual(0)
      expect(r.equal).toBe(r.diffCount === 0)
      expect(typeof r.formatted).toBe("string")
      expect(r.formatted.length).toBeGreaterThan(0)
    }
  })

  test("per-stream divergence stays within the recorded baseline", () => {
    for (const r of results) {
      const base = BASELINE[r.name]
      if (base === undefined) throw new Error(`no baseline recorded for stream "${r.name}"`)

      // Regression gate: diverging more than recorded fails loudly. See the
      // collection-time summary above for the formatted diff of each stream.
      expect(
        r.diffCount,
        `stream "${r.name}" diverged in ${r.diffCount} cells, above the recorded ` +
          `baseline of ${base}. The vterm guest regressed against the xterm reference — ` +
          `investigate the printed diff before raising the baseline.`,
      ).toBeLessThanOrEqual(base)
    }
  })
})
