/**
 * Regression test: `termless rec --live-chrome` defaults to whatever
 * `--chrome` is set to (user mental model: "I asked for chrome, give me
 * chrome"). Bare `rec` still has both chrome and live-chrome off — that
 * preserves the 2026-05-22 safety default against the compositing-leak
 * bugs in the silvery-mounted overlay path.
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
 * - 2026-05-26 fix: `--live-chrome` inherits from `--chrome` when
 *   unspecified, so `--chrome macos` opts into BOTH bordered output AND
 *   centered macOS chrome on the live preview. Bare `rec` still has both
 *   `none`. Pass `--live-chrome none` explicitly to keep output chrome
 *   while opting out of the live overlay.
 *
 * If this test starts failing because the default was flipped back to
 * unconditional `"none"`, verify FIRST that the user's "I want chrome
 * on live recording" feature can still be reached via a single-flag
 * opt-in. Until islands ships the by-construction-correct overlay,
 * passing `--chrome` MUST imply `--live-chrome` of the same style.
 */

import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const RECORD_CMD_SRC = readFileSync(join(__dirname, "..", "src", "record-cmd.ts"), "utf8")

describe("rec --live-chrome inherits from --chrome when unspecified (2026-05-26)", () => {
  test("runtime: liveChromeStyle defaults to chromeStyle when --live-chrome is unset", () => {
    // The runtime resolution: liveChrome = opts.liveChrome ?? chromeStyle.
    // This is the load-bearing line — without it, `rec --chrome macos`
    // gives bordered output but flush-top-left raw-stdout live preview.
    expect(RECORD_CMD_SRC).toMatch(
      /const liveChromeStyle:\s*ChromeStyle\s*=\s*\(opts\.liveChrome[^)]*\)\s*\?\?\s*chromeStyle/,
    )
    // Must NOT fall back to a hardcoded literal — that's the 2026-05-22
    // interim shape that produced the user-visible regression.
    expect(RECORD_CMD_SRC).not.toMatch(
      /const liveChromeStyle:\s*ChromeStyle\s*=\s*\(opts\.liveChrome[^)]*\)\s*\?\?\s*"none"/,
    )
    expect(RECORD_CMD_SRC).not.toMatch(
      /const liveChromeStyle:\s*ChromeStyle\s*=\s*\(opts\.liveChrome[^)]*\)\s*\?\?\s*"macos"/,
    )
  })

  test("CLI --live-chrome option declares NO default value (commander leaves it undefined)", () => {
    // Removing the commander default is what lets the runtime distinguish
    // "user passed --live-chrome none" from "user didn't pass anything".
    // The runtime then inherits from chromeStyle.
    const optionBlock = RECORD_CMD_SRC.match(/"--live-chrome <style>"[\s\S]{0,800}?\)\n/)?.[0]
    expect(optionBlock, "could not locate --live-chrome option block").toBeTruthy()
    // The .option() call's third positional arg is the default value. We
    // need to NOT have it — match the closing `)` after the help string
    // (template literal + concatenation) directly, no `, "<defaultval>"`.
    expect(optionBlock).not.toMatch(/,\s*"none"\s*,?\s*\)\s*$/m)
    expect(optionBlock).not.toMatch(/,\s*"macos"\s*,?\s*\)\s*$/m)
  })

  test("CLI --chrome option still defaults to 'none' — the safety default for bare `rec`", () => {
    // `--chrome` is the FIRST flag the user reaches for. Its default is
    // load-bearing: bare `rec` ⇒ `chromeStyle = "none"` ⇒ inherited
    // `liveChromeStyle = "none"` ⇒ overlay disabled ⇒ no compositing-
    // leak bugs hit users who don't ask for chrome.
    // The --chrome option line is single-line; locate by the literal flag
    // marker and assert the trailing `, "none")` default-value tail.
    const chromeLine = RECORD_CMD_SRC.split("\n").find((line) => line.includes('"--chrome <style>"'))
    expect(chromeLine, "could not locate --chrome option line").toBeTruthy()
    expect(chromeLine).toMatch(/,\s*"none"\)\s*$/)
  })

  test("CLI help text documents the inheritance behavior", () => {
    // The help string should explain "--live-chrome inherits from --chrome".
    // Future readers (humans + LLMs) need to see this without grep-spelunking
    // the runtime default site.
    expect(RECORD_CMD_SRC).toMatch(/Defaults? to whatever\s+\\?`--chrome\\?`/i)
  })
})
