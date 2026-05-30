/**
 * LIVE-capture tests for `compat-screenshot` — real desktop-terminal capture.
 *
 * This file is `.slow.test.ts` — excluded from the default `vitest run`
 * (see vitest.config.ts). The tests within are additionally DOUBLE-GUARDED
 * so they never spawn a window implicitly:
 *
 *  1. HARD GATE — they only run when `TERMLESS_PEEKABOO_LIVE=1` is set.
 *     UNSET BY DEFAULT, so even an explicit slow-suite run skips them.
 *     Live capture spawns a real terminal window that steals focus, so it
 *     must never happen without an explicit opt-in.
 *  2. CAPABILITY GATE — even when opted in, they additionally require
 *     macOS + a GUI session + the app installed, and skip (not fail)
 *     otherwise.
 *
 * Pure-logic smoke tests (wrapper-script generation, env guards, terminal
 * detection) — which never spawn a window — live in the sibling
 * `compat-screenshot.test.ts` and run in the default suite.
 *
 * To exercise live capture deliberately (this WILL pop terminal windows):
 *   TERMLESS_PEEKABOO_LIVE=1 bun vitest run packages/peekaboo/tests/compat-screenshot.slow.test.ts
 */

import { describe, it, expect } from "vitest"
import { existsSync, statSync } from "node:fs"
import { unlink } from "node:fs/promises"
import {
  assertCompatCapable,
  detectTerminal,
  isTerminalInstalled,
  compatScreenshot,
  COMPAT_TERMINAL_PREFERENCE,
  type CompatTerminal,
} from "../src/index.ts"

const isMac = process.platform === "darwin"

/** Hard opt-in for live capture — unset by default → live tests skip. */
const LIVE_ENABLED = process.env.TERMLESS_PEEKABOO_LIVE === "1"

/**
 * Whether the host can run live captures: requires the explicit opt-in env
 * var AND macOS + a GUI session + Screen Recording permission. Without the
 * opt-in this always returns false — no window is ever spawned implicitly.
 */
async function canCapture(): Promise<boolean> {
  if (!LIVE_ENABLED) return false
  if (!isMac) return false
  try {
    await assertCompatCapable()
    return true
  } catch {
    return false
  }
}

describe("compat-screenshot: live capture (opt-in, macOS + GUI)", () => {
  it.skipIf(!LIVE_ENABLED)("captures `echo hello` in each installed terminal app", async () => {
    if (!(await canCapture())) {
      return
    }

    let capturedAny = false
    for (const terminal of COMPAT_TERMINAL_PREFERENCE as readonly CompatTerminal[]) {
      if (!(await isTerminalInstalled(terminal))) {
        console.log(`[skip] ${terminal} not installed`)
        continue
      }
      const result = await compatScreenshot({
        cmd: "echo hello",
        terminal,
        cols: 80,
        rows: 24,
        waitTimeoutMs: 6_000,
      })
      expect(result.mimeType).toBe("image/png")
      expect(existsSync(result.path)).toBe(true)
      expect(statSync(result.path).size).toBeGreaterThan(0)
      expect(result.terminal.name).toBe(terminal)
      capturedAny = true
      try {
        await unlink(result.path)
      } catch {
        // ignore
      }
    }
    if (!capturedAny) {
      return
    }
  }, 60_000)

  it.skipIf(!LIVE_ENABLED)("auto-detects a terminal when none specified", async () => {
    if (!(await canCapture())) {
      return
    }
    const detected = await detectTerminal()
    if (!detected) {
      return
    }
    const result = await compatScreenshot({ cmd: "echo hello", cols: 80, rows: 24, waitTimeoutMs: 6_000 })
    expect(result.terminal.name).toBe(detected)
    try {
      await unlink(result.path)
    } catch {
      // ignore
    }
  }, 60_000)
})
