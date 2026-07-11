import { describe, expect, test, vi } from "vitest"
import { XtermAdapter } from "../src/viewport-adapter.ts"
import type { ViewportContext } from "../src/silvery-compat.ts"

function ctx(): ViewportContext {
  return {
    dimensions: () => ({ cols: 8, rows: 2 }),
    blit: vi.fn(),
    setCursor: vi.fn(),
    invalidateAll: vi.fn(),
    requestInputMode: vi.fn(),
    emitTitle: vi.fn(),
  }
}

describe("XtermAdapter", () => {
  test("connects to a viewport context and reports the default input mode", () => {
    const adapter = XtermAdapter({ cols: 8, rows: 2 })
    const viewport = ctx()

    adapter.connect(viewport)

    expect(viewport.requestInputMode).toHaveBeenCalledWith("none")
    expect(viewport.blit).toHaveBeenCalled()
    adapter.disconnect()
  })
})
