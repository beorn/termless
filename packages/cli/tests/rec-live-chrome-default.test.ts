/**
 * Regression test: `termless rec --live-chrome` defaults to `"none"` (raw-stdout
 * passthrough), NOT `"macos"` (silvery-mounted bordered chrome).
 *
 * Background: 2026-05-22 interim flip. The silvery overlay path had 6 rounds of
 * compositing-leak bugs (15551 / 15575 / 15586 / 15589.A/B/C/D + round-6:
 * OSC palette-probe responses leaking as visible cells + keystroke echo +
 * Ctrl-D-dead). The structural fix (`@km/silvery/15646-islands`) is a
 * quarter-investment epic. Meanwhile, the default flips to `"none"` so the
 * recorded program (km view / nvim / htop / any) renders directly to the host
 * terminal — the host (Ghostty / iTerm / etc.) handles probes natively, the
 * recording still captures via the headless backend, and users see clean
 * recordings TODAY instead of garble.
 *
 * Opt-back-in: `--live-chrome macos` still works exactly as before. It is the
 * legacy path until islands ships the by-construction-correct overlay.
 *
 * If this test starts failing because the default was flipped back to
 * `"macos"`, verify FIRST that `@km/silvery/15646-islands` shipped and the
 * silvery overlay is by-construction-correct. Until then, the default MUST
 * stay `"none"`.
 */

import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const RECORD_CMD_SRC = readFileSync(join(__dirname, "..", "src", "record-cmd.ts"), "utf8")

describe("rec --live-chrome default flipped to 'none' (interim 2026-05-22)", () => {
  test("runtime default in runRecord: liveChrome ?? 'none'", () => {
    // Look for the runtime default line. It MUST resolve to "none", not
    // "macos" — see file header comment for rationale.
    expect(RECORD_CMD_SRC).toMatch(/const liveChrome:\s*ChromeStyle\s*=\s*opts\.liveChrome\s*\?\?\s*"none"/)
    expect(RECORD_CMD_SRC).not.toMatch(/const liveChrome:\s*ChromeStyle\s*=\s*opts\.liveChrome\s*\?\?\s*"macos"/)
  })

  test("runtime default in parseRecOptions: liveChromeStyle ?? 'none'", () => {
    expect(RECORD_CMD_SRC).toMatch(
      /const liveChromeStyle:\s*ChromeStyle\s*=\s*\(opts\.liveChrome[^)]*\)\s*\?\?\s*"none"/,
    )
    expect(RECORD_CMD_SRC).not.toMatch(
      /const liveChromeStyle:\s*ChromeStyle\s*=\s*\(opts\.liveChrome[^)]*\)\s*\?\?\s*"macos"/,
    )
  })

  test("CLI --live-chrome option declares default value as 'none'", () => {
    // Commander.option('--live-chrome <style>', help, defaultValue) — the
    // defaultValue MUST be "none" so `program.opts().liveChrome` is "none"
    // when no flag is passed (matches the runtime fallback above).
    const optionBlock = RECORD_CMD_SRC.match(/"--live-chrome <style>"[\s\S]{0,800}?\)\s*\n/)?.[0]
    expect(optionBlock, "could not locate --live-chrome option block").toBeTruthy()
    // The default-value argument is the last positional arg to .option(). It
    // must be the literal string "none".
    expect(optionBlock).toMatch(/,\s*"none",?\s*\)\s*$/m)
    expect(optionBlock).not.toMatch(/,\s*"macos",?\s*\)\s*$/m)
  })

  test("CLI help text reflects the new default + opt-in path for the legacy chrome", () => {
    expect(RECORD_CMD_SRC).toMatch(/default:\s*none[^)]*raw-stdout passthrough/i)
    // The help text should mention how to opt back into the silvery chrome.
    // (The source file has backticks escaped as \` inside a template literal,
    // so the raw file bytes carry literal `\``.)
    expect(RECORD_CMD_SRC).toMatch(/Pass\s+\\?`macos\\?`/)
  })
})
