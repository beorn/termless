import { describe, it, expect } from "vitest"
import { chromeMetrics, computeLayout } from "../src/rec-overlay-geometry.ts"

describe("chromeMetrics", () => {
  it("macos: 2 top rows (title bar + edge) + 1 bottom + 1 side each", () => {
    expect(chromeMetrics("macos")).toMatchObject({
      topRows: 2,
      bottomRows: 1,
      leftCols: 1,
      rightCols: 1,
      showTitleBar: true,
      showDots: true,
    })
  })

  it("windows: same row/col counts as macos but no traffic-light dots", () => {
    const m = chromeMetrics("windows")
    expect(m.showDots).toBe(false)
    expect(m.showTitleBar).toBe(true)
    expect(m.border).not.toBeNull()
  })

  it("none: zero chrome — no border, no title bar", () => {
    expect(chromeMetrics("none")).toMatchObject({
      topRows: 0,
      bottomRows: 0,
      showTitleBar: false,
      border: null,
    })
  })
})

describe("computeLayout — centering", () => {
  it("centers an 80×30 grid + macos chrome in a 100×50 host", () => {
    const m = chromeMetrics("macos")
    const layout = computeLayout(100, 50, 80, 30, m)
    expect(layout.frameWidth).toBe(82) // 80 grid + 1 left + 1 right
    expect(layout.frameHeight).toBe(33) // 30 grid + 2 top + 1 bottom
    // Frame should be roughly centered: (100 - 82) / 2 = 9 → 1-based col = 10
    expect(layout.frameLeft).toBe(10)
    // Total stack = 33 + 2 (status reserve) = 35. (50-35)/2 = 7 → 1-based row = 8
    expect(layout.statusRow).toBe(8)
    expect(layout.frameTop).toBe(10) // 8 + 2 reserve
    expect(layout.gridTop).toBe(12) // frameTop + 2 (top chrome rows)
    expect(layout.gridLeft).toBe(11) // frameLeft + 1 (left chrome col)
    expect(layout.visibleCols).toBe(80)
    expect(layout.visibleRows).toBe(30)
  })

  it("clamps to (1,1) when host is smaller than the frame", () => {
    const m = chromeMetrics("macos")
    const layout = computeLayout(40, 20, 80, 30, m)
    expect(layout.frameLeft).toBe(1)
    expect(layout.statusRow).toBe(1)
    // Visible region clips to whatever the host can show.
    expect(layout.visibleCols).toBeLessThanOrEqual(40)
    expect(layout.visibleRows).toBeLessThanOrEqual(20)
  })

  it("with --live-chrome none: grid is centered with no border padding", () => {
    const m = chromeMetrics("none")
    const layout = computeLayout(100, 50, 80, 30, m)
    expect(layout.frameWidth).toBe(80)
    expect(layout.frameHeight).toBe(30)
    expect(layout.gridLeft).toBe(layout.frameLeft) // no left chrome col
    expect(layout.gridTop).toBe(layout.frameTop)
  })

  it("visibleRows never goes negative", () => {
    const m = chromeMetrics("macos")
    const layout = computeLayout(80, 4, 80, 30, m)
    expect(layout.visibleRows).toBeGreaterThanOrEqual(0)
    expect(layout.visibleCols).toBeGreaterThanOrEqual(0)
  })
})
