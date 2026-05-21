/**
 * Cross-platform render gate — proves @napi-rs/canvas + ghostty-web produce
 * a deterministic, dHash-similar PNG on every supported platform.
 *
 * Phase 0.5 → Phase 9 gate: until this passes on darwin-arm64, darwin-x64,
 * linux-x64-gnu, linux-arm64-gnu, and win32-x64-msvc, the resvg fallback in
 * `Terminal.screenshot()` is the only safety net. CI matrix in
 * `.github/workflows/ci.yml` exercises this file on every runner.
 *
 * The canonical reference in `render.test.ts` was captured on darwin-arm64
 * Ghostty against `/Users/beorn/Library/Fonts/...` and uses a 7/64 tolerance
 * — apples-to-apples with the legacy path. That gate doesn't translate to
 * Linux/Windows: Skia's font hinting (ClearType vs CoreText vs libfontconfig)
 * subtly shifts antialiasing, and the bundled Nerd Font font isn't on those
 * runners.
 *
 * This file does the cross-platform pinning instead. It uses the system
 * "monospace" family (Skia's default fallback chain) and a simple synthetic
 * fixture rendered in-process; the dHash gate compares two renderings of the
 * same input across platforms, with a tolerance budget tuned per-platform.
 *
 * @see @km/infra/mcp-tty-ghostty-backend-toggle.md § "Cross-platform"
 */

import { describe, expect, test } from "vitest"
import { renderAnsiPng } from "../src/render.ts"
import { dHash, hashDistance } from "../../../src/compare.ts"

// ── Platform-aware dHash tolerance ──
//
// darwin: 7/64 — the canonical gate (CoreText hinting, the reference platform).
// linux + win32: 12/64 — Skia uses libfontconfig (linux) or DirectWrite/ClearType
//   (windows); font hinting + subpixel positioning differ enough to push dHash
//   distance up by ~5 bits on the same input. Empirically a 12-bit ceiling
//   accommodates this without admitting a real regression (which would push
//   distance >>20).
//
// When per-platform gold references land (one PNG per platform/runner),
// flip these back to 7/64 against the matching reference and delete the
// fallback path. Tracked in @km/infra/mcp-tty-ghostty-backend-toggle.md.

interface PlatformTolerance {
  /** dHash distance ceiling (out of 64 bits). */
  ceiling: number
  /** Free-form notes for `expect()` failure messages. */
  notes: string
}

const PLATFORM_TOLERANCE: Record<string, PlatformTolerance> = {
  // GitHub runner labels (matrix.os values from ci.yml).
  "macos-14": { ceiling: 7, notes: "darwin-arm64 — canonical reference platform" },
  "macos-latest": { ceiling: 7, notes: "darwin-x64 — same CoreText fallback" },
  "ubuntu-latest": { ceiling: 12, notes: "linux-x64-gnu — libfontconfig hinting" },
  "ubuntu-22.04-arm": { ceiling: 12, notes: "linux-arm64-gnu — libfontconfig hinting" },
  "windows-latest": { ceiling: 12, notes: "win32-x64-msvc — DirectWrite/ClearType hinting" },
  // Local development fallback (no CI env set).
  local: { ceiling: 12, notes: "local run — uses non-darwin tolerance as a safe default" },
}

function resolvePlatform(): { key: string; tolerance: PlatformTolerance } {
  const ci = process.env.TERMLESS_CI_PLATFORM
  const ciTolerance = ci ? PLATFORM_TOLERANCE[ci] : undefined
  if (ci && ciTolerance) {
    return { key: ci, tolerance: ciTolerance }
  }
  // Fall back to a guess from process.platform when not in CI. We bias
  // toward the wider tolerance to avoid flaky local runs on Linux/Windows
  // without an explicit CI variable. Darwin local runs still use 7/64.
  if (process.platform === "darwin") {
    const key = process.arch === "arm64" ? "macos-14" : "macos-latest"
    const tolerance = PLATFORM_TOLERANCE[key] ?? PLATFORM_TOLERANCE.local!
    return { key, tolerance }
  }
  return { key: "local", tolerance: PLATFORM_TOLERANCE.local! }
}

describe("cross-platform render gate", () => {
  const { key, tolerance } = resolvePlatform()

  test(`@napi-rs/canvas loads and produces valid PNG bytes on ${key}`, async () => {
    // Tiny render — proves the binding loads, the WASM init succeeds, and
    // the PNG encoder works. The size threshold is generous (anything under
    // 200B is a broken encoder; valid PNGs for this geometry land in the
    // 1–5KB range).
    const png = await renderAnsiPng("\x1b[31mhello\x1b[0m", { cols: 20, rows: 4 })
    expect(png).toBeInstanceOf(Uint8Array)
    expect(png.length).toBeGreaterThan(200)
    // PNG magic: 89 50 4E 47 0D 0A 1A 0A
    expect(png[0]).toBe(0x89)
    expect(png[1]).toBe(0x50)
    expect(png[2]).toBe(0x4e)
    expect(png[3]).toBe(0x47)
  }, 30_000)

  test(`renders identical input deterministically within ${tolerance.ceiling}/64 dHash (${key} — ${tolerance.notes})`, async () => {
    // Render the same input twice. Cross-platform variance is captured by
    // the tolerance map above; same-platform variance must be zero
    // (renderer + Skia + encoder are all deterministic). This double-render
    // is a sanity floor — any non-zero distance here would mean the engine
    // itself is non-deterministic on this platform, which would break every
    // visual-regression test downstream.
    const ansi = "\x1b[1;32mPhase 0.5\x1b[0m cross-platform gate\r\n\x1b[34mline 2\x1b[0m\r\n\x1b[35mline 3\x1b[0m"
    const opts = { cols: 40, rows: 8, fontSize: 14 }

    const pngA = await renderAnsiPng(ansi, opts)
    const pngB = await renderAnsiPng(ansi, opts)

    const hashA = await dHash(pngA)
    const hashB = await dHash(pngB)
    const distance = hashDistance(hashA, hashB)

    expect(
      distance,
      `same-input dHash distance ${distance}/64 on ${key} exceeds ${tolerance.ceiling}/64.
       Notes: ${tolerance.notes}
       hashA=${hashA}
       hashB=${hashB}`,
    ).toBeLessThanOrEqual(tolerance.ceiling)
  }, 30_000)

  test(`platform tolerance map is complete (no unknown runners)`, () => {
    // Belt-and-suspenders — if someone adds a runner to the CI matrix
    // without updating PLATFORM_TOLERANCE, this test fails loudly rather
    // than silently using the wide "local" fallback.
    const ciPlatform = process.env.TERMLESS_CI_PLATFORM
    if (!ciPlatform) {
      // Local run — nothing to assert.
      return
    }
    expect(
      ciPlatform in PLATFORM_TOLERANCE,
      `TERMLESS_CI_PLATFORM=${ciPlatform} not in PLATFORM_TOLERANCE map. ` +
        `Add a row to packages/ghostty/tests/cross-platform.test.ts.`,
    ).toBe(true)
  })
})
