/**
 * Tests for the `browser` renderer — opt-in headless-Chromium rasterizer.
 *
 * Two contracts are pinned:
 *
 *  1. **The union + error path.** `RendererKind` includes `"browser"`, and
 *     `selectRasterizer("browser")` throws a clear, actionable error when the
 *     optional `playwright` package is absent. The absent case is simulated
 *     with `vi.doMock` so the test holds regardless of whether playwright is
 *     installed in the worktree.
 *
 *  2. **The smoke path.** When playwright (+ a Chromium binary) IS available,
 *     `browser` rasterizes a km-ish SVG frame to a non-empty PNG. Gated with
 *     `test.skipIf` so a default install (no playwright) still passes.
 */

import { describe, test, expect, vi, afterEach } from "vitest"
import { createRequire } from "node:module"
import { existsSync } from "node:fs"
import type { RendererKind } from "../../src/view/rasterizer.ts"

const require_ = createRequire(import.meta.url)

/** Whether the optional `playwright` package resolves in this worktree. */
function playwrightInstalled(): boolean {
  try {
    require_.resolve("playwright")
    return true
  } catch {
    return false
  }
}
const PLAYWRIGHT_INSTALLED = playwrightInstalled()

/**
 * Whether a launchable Chromium binary is actually present. The `playwright`
 * package can be installed without the browser binaries — `playwright install
 * chromium` is a separate step. CI installs the package but not the binary, so
 * the smoke test (which launches a real browser) must gate on the binary, not
 * just the package. `chromium.executablePath()` is synchronous and points at
 * the resolved binary path; the binary may or may not exist on disk.
 */
function chromiumBinaryAvailable(): boolean {
  if (!PLAYWRIGHT_INSTALLED) return false
  try {
    const { chromium } = require_("playwright") as {
      chromium: { executablePath(): string }
    }
    const path = chromium.executablePath()
    return !!path && existsSync(path)
  } catch {
    return false
  }
}
const CHROMIUM_AVAILABLE = chromiumBinaryAvailable()

/** A small km-ish SVG terminal frame — embedded fonts, a board-like card. */
const KM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120" preserveAspectRatio="xMidYMid meet">
<rect width="100%" height="100%" fill="#1e1e1e"/>
<rect x="0" y="0" width="320" height="20" fill="#264f78"/>
<text x="0" y="16" font-family="monospace" font-size="16" fill="#d4d4d4"><tspan x="8">@km · termless board</tspan></text>
<text x="0" y="56" font-family="monospace" font-size="16" fill="#9cdcfe"><tspan x="8">[ ] chromium renderer</tspan></text>
<text x="0" y="96" font-family="monospace" font-size="16" fill="#6a9955"><tspan x="8">[x] swash renderer</tspan></text>
</svg>`

afterEach(() => {
  vi.resetModules()
  vi.doUnmock("playwright")
})

describe("browser renderer — RendererKind", () => {
  test('"browser" is a valid RendererKind', () => {
    // Compile-time: this assignment fails to typecheck if "browser" is absent
    // from the union. Runtime: a trivial truthy assertion to pin the test.
    const kind: RendererKind = "browser"
    expect(kind).toBe("browser")
  })
})

describe("browser renderer — playwright absent", () => {
  test("selectRasterizer('browser') throws an actionable install error", async () => {
    // Simulate a default install with no playwright: make the dynamic import
    // of "playwright" reject, exactly as a missing package would.
    vi.doMock("playwright", () => {
      throw new Error("Cannot find package 'playwright'")
    })
    vi.resetModules()
    const { selectRasterizer } = await import("../../src/view/rasterizer.ts")

    await expect(selectRasterizer("browser")).rejects.toThrow(/optional playwright package/)
    await expect(selectRasterizer("browser")).rejects.toThrow(/bun add -d playwright/)
    await expect(selectRasterizer("browser")).rejects.toThrow(/playwright install chromium/)
  })

  test("a missing playwright does not affect resvg selection", async () => {
    vi.doMock("playwright", () => {
      throw new Error("Cannot find package 'playwright'")
    })
    vi.resetModules()
    const { selectRasterizer } = await import("../../src/view/rasterizer.ts")
    // resvg is bundled — it must still resolve with playwright absent.
    const rasterizer = await selectRasterizer("resvg")
    expect(rasterizer.kind).toBe("resvg")
  })
})

describe("browser renderer — smoke (playwright + Chromium binary installed)", () => {
  test.skipIf(!CHROMIUM_AVAILABLE)(
    "rasterizes a km-ish SVG frame to a non-empty PNG",
    async () => {
      const { selectRasterizer } = await import("../../src/view/rasterizer.ts")
      const rasterizer = await selectRasterizer("browser")
      expect(rasterizer.kind).toBe("browser")
      try {
        const png = await rasterizer.toPng(KM_SVG, 2)
        expect(png.length).toBeGreaterThan(100)
        // PNG magic number: 0x89 'P' 'N' 'G'.
        expect(Array.from(png.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])

        // The RGBA path must also yield a sized bitmap.
        const bmp = await rasterizer.rasterize(KM_SVG, 2)
        expect(bmp.width).toBeGreaterThan(0)
        expect(bmp.height).toBeGreaterThan(0)
        expect(bmp.pixels.length).toBe(bmp.width * bmp.height * 4)
      } finally {
        await rasterizer.dispose?.()
      }
    },
    60_000,
  )
})
