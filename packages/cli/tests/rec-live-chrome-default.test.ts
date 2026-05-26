/**
 * Regression test: `termless rec --live-chrome` defaults to a live macOS
 * chrome again now that the overlay is an Island boundary. When output
 * `--chrome` is set to a concrete style, live chrome follows that style;
 * `--live-chrome none` remains the explicit opt-out.
 *
 * Background (history):
 *
 * - 2026-05-22 (`7425ba5`): live-chrome default flipped `macos` → `none`
 *   as interim against the 6 rounds of compositing-leak bugs in the
 *   silvery overlay path (15551 / 15575 / 15586 / 15589.A/B/C/D + round-6
 *   palette-probe / keystroke echo / Ctrl-D-dead). The structural fix
 *   (`@km/silvery/15646-islands`) is a quarter-investment epic.
 * - 2026-05-25 user re-report: `termless rec --chrome macos -- km view ~vault`
 *   showed flush-top-left raw stdout with no chrome and no REC indicator.
 *   The 2026-05-22 default-off interim was too aggressive — it caught
 *   even the explicit-chrome opt-in path. See
 *   `@km/termless/rec-live-chrome-centered-frame`.
 * - 2026-05-26 Phase 2 interim: `--live-chrome` inherited from `--chrome`
 *   when unspecified, so `--chrome macos` opted into BOTH bordered output
 *   AND centered macOS chrome on the live preview. Bare `rec` still had
 *   both `none` while Islands was incomplete.
 * - 2026-05-26 Phase 3: rec-live-overlay moved to `<Island guest={xtermGuest}>`.
 *   The structural boundary exists, so bare `rec` can show the centered REC
 *   chrome by default again. Pass `--live-chrome none` to opt out.
 *
 * If this test starts failing because the default was flipped back to
 * unconditional `"none"`, verify FIRST that the centered live REC overlay
 * still appears for bare `rec`. Passing `--chrome` MUST keep implying a
 * matching `--live-chrome` style, unless the user explicitly passes
 * `--live-chrome none`.
 */

import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const RECORD_CMD_SRC = readFileSync(join(__dirname, "..", "src", "record-cmd.ts"), "utf8")

describe("rec --live-chrome defaults to centered live macOS chrome (2026-05-26)", () => {
  test("runtime: bare rec defaults liveChromeStyle to macos, styled output syncs live style", () => {
    expect(RECORD_CMD_SRC).toMatch(
      /const defaultLiveChromeStyle:\s*ChromeStyle\s*=\s*chromeStyle\s*===\s*"none"\s*\?\s*"macos"\s*:\s*chromeStyle/,
    )
    expect(RECORD_CMD_SRC).toMatch(
      /const liveChromeStyle:\s*ChromeStyle\s*=\s*\(opts\.liveChrome[^)]*\)\s*\?\?\s*defaultLiveChromeStyle/,
    )
    expect(RECORD_CMD_SRC).not.toMatch(
      /const liveChromeStyle:\s*ChromeStyle\s*=\s*\(opts\.liveChrome[^)]*\)\s*\?\?\s*"none"/,
    )
  })

  test("CLI --live-chrome option declares NO default value (commander leaves it undefined)", () => {
    // Removing the commander default is what lets the runtime distinguish
    // "user passed --live-chrome none" from "user didn't pass anything".
    // The runtime then chooses macos for bare rec, or inherits concrete
    // output chrome styles.
    const optionBlock = RECORD_CMD_SRC.match(/"--live-chrome <style>"[\s\S]{0,800}?\)\n/)?.[0]
    expect(optionBlock, "could not locate --live-chrome option block").toBeTruthy()
    // The .option() call's third positional arg is the default value. We
    // need to NOT have it — match the closing `)` after the help string
    // (template literal + concatenation) directly, no `, "<defaultval>"`.
    expect(optionBlock).not.toMatch(/,\s*"none"\s*,?\s*\)\s*$/m)
    expect(optionBlock).not.toMatch(/,\s*"macos"\s*,?\s*\)\s*$/m)
  })

  test("CLI --chrome option still defaults to 'none' for rendered output", () => {
    // Output artifacts stay unframed by default. Live preview is now a
    // separate by-construction-safe default (`macos`) unless the user passes
    // `--live-chrome none`.
    // The --chrome option line is single-line; locate by the literal flag
    // marker and assert the trailing `, "none")` default-value tail.
    const chromeLine = RECORD_CMD_SRC.split("\n").find((line) => line.includes('"--chrome <style>"'))
    expect(chromeLine, "could not locate --chrome option line").toBeTruthy()
    expect(chromeLine).toMatch(/,\s*"none"\)\s*$/)
  })

  test("CLI help text documents the default and opt-out behavior", () => {
    // The help string should explain the live macOS default plus the explicit
    // opt-out and output-chrome sync behavior.
    // Future readers (humans + LLMs) need to see this without grep-spelunking
    // the runtime default site.
    expect(RECORD_CMD_SRC).toMatch(/defaults? to a centered macOS chrome/i)
    expect(RECORD_CMD_SRC).toMatch(/--live-chrome none/i)
  })
})
