import { readFileSync } from "node:fs"
import { join } from "node:path"
import React from "react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createCellBuffer } from "@silvery/ag/viewport-buffer"
import type { IslandGuest, IslandHandle, IslandOutputOwner, IslandSizeOwner } from "@silvery/ag/island-types"
import { createScope } from "@silvery/scope"
import { createRenderer } from "@silvery/test"
import { ScopeProvider } from "silvery"
import { Overlay, chromeTokens, createOverlayStore } from "../src/rec-live-overlay.tsx"

const SRC = readFileSync(join(__dirname, "..", "src", "rec-live-overlay.tsx"), "utf8")

function inertGuest(): IslandGuest {
  return {
    init(ctx) {
      const size: IslandSizeOwner = {
        get cols() {
          return ctx.cols
        },
        get rows() {
          return ctx.rows
        },
        subscribe: () => () => {},
        requestResize() {},
      }
      const output: IslandOutputOwner = {
        buffer: createCellBuffer(ctx.cols, ctx.rows),
        cursor: null,
        cursorVisible: false,
        subscribe: () => () => {},
        writeCells() {},
        invalidateAll() {},
      }
      const handle: IslandHandle = { size, output, dispose() {} }
      ctx.emit({ type: "ready" })
      return Promise.resolve(handle)
    },
  }
}

describe("rec-live-overlay REC pulse", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test("REC dot delegates blink lifecycle to silvery usePulse", () => {
    expect(SRC).toMatch(/\busePulse\b/)
    expect(SRC).toMatch(/intervalMs:\s*500/)
    expect(SRC).not.toMatch(/\bblinkTick\b/)
    expect(SRC).not.toMatch(/\bblinkTimer\b/)
    expect(SRC).not.toMatch(/setInterval\(\s*\(\)\s*=>\s*\{[\s\S]{0,300}blink/i)
  })

  test("REC dot visibly toggles on the 500ms pulse boundary", async () => {
    const render = createRenderer({ cols: 40, rows: 6 })
    const scope = createScope("rec-live-overlay-pulse-test")
    const store = createOverlayStore({ revision: 0, elapsedMs: 0 })
    const tree = () =>
      React.createElement(
        ScopeProvider,
        { appScope: scope, scope },
        React.createElement(Overlay, {
          guest: inertGuest(),
          cols: 1,
          rows: 1,
          title: "rec",
          preset: chromeTokens("none"),
          store,
        }),
      )

    const app = render(tree())
    expect(app.text).toContain("● REC 0:00")

    await vi.advanceTimersByTimeAsync(500)
    app.rerender(tree())
    expect(app.text).not.toContain("● REC 0:00")
    expect(app.text).toContain(" REC 0:00")

    await vi.advanceTimersByTimeAsync(500)
    app.rerender(tree())
    expect(app.text).toContain("● REC 0:00")

    app.unmount()
    await scope[Symbol.asyncDispose]()
  })
})
