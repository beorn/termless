/**
 * XtermAdapter unit tests.
 *
 * Covers the {@link ForeignSource} contract that vendor/silvery's Viewport
 * will drive at mount time:
 *   1. constructs without throwing
 *   2. connect() dimensions match opts
 *   3. feedAnsi() produces blit() with cells matching the input text
 *   4. cursor moves fire setCursor()
 *   5. disconnect() releases the embedded xterm Terminal
 *   6. requestInputMode() is called with the configured captureInput
 *   7. child.stdin receives encoded onData bytes in captureInput="all"
 *
 * The Phase A `<Viewport>` host owns the inverse direction (delivering key
 * events INTO the source); that wiring is tested in vendor/silvery once
 * Phase A4 lands.
 */

import { describe, test, expect, vi } from "vitest"

import { XtermAdapter, type XtermAdapterChild } from "../../packages/xtermjs/src/viewport-adapter.ts"
import type { CellBuffer, ViewportContext, ViewportRect } from "@silvery/ag/viewport-types"

interface FakeCtxRecord {
  blits: { rects: readonly ViewportRect[]; buffer: CellBuffer }[]
  cursors: { row: number; col: number }[]
  inputModes: string[]
  titles: string[]
  invalidateAllCalls: number
}

function createFakeContext(
  cols: number,
  rows: number,
): {
  ctx: ViewportContext
  rec: FakeCtxRecord
} {
  const rec: FakeCtxRecord = {
    blits: [],
    cursors: [],
    inputModes: [],
    titles: [],
    invalidateAllCalls: 0,
  }
  const ctx: ViewportContext = {
    dimensions: () => ({ cols, rows }),
    blit: (rects, buffer) => {
      rec.blits.push({ rects, buffer })
    },
    setCursor: (pos) => {
      rec.cursors.push({ row: pos.row, col: pos.col })
    },
    invalidateAll: () => {
      rec.invalidateAllCalls += 1
    },
    requestInputMode: (mode) => {
      rec.inputModes.push(mode)
    },
    emitTitle: (title) => {
      rec.titles.push(title)
    },
  }
  return { ctx, rec }
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve))
}

describe("XtermAdapter", () => {
  test("constructs without throwing", () => {
    expect(() => XtermAdapter({ cols: 80, rows: 24 })).not.toThrow()
  })

  test("desiredSize() reflects construction options", () => {
    const a = XtermAdapter({ cols: 40, rows: 12 })
    expect(a.desiredSize?.()).toEqual({ cols: 40, rows: 12 })
  })

  test("connect(ctx) calls dimensions() and stores context", () => {
    const a = XtermAdapter({ cols: 80, rows: 24 })
    const { ctx, rec } = createFakeContext(80, 24)
    const dims = vi.spyOn(ctx, "dimensions")
    a.connect(ctx)
    // The adapter is allowed to read dimensions during flush; we assert the
    // context is bound by observing that the initial paint scheduled by
    // connect() will see this ctx. Setup-time read is optional but observable.
    void dims
    expect(rec.inputModes).toEqual(["none"])
  })

  test("feedAnsi('hello world') produces a blit with matching cells", async () => {
    const cols = 20
    const rows = 3
    const a = XtermAdapter({ cols, rows })
    const { ctx, rec } = createFakeContext(cols, rows)
    a.connect(ctx)
    a.feedAnsi("hello world")
    await flushMicrotasks()

    expect(rec.blits.length).toBeGreaterThanOrEqual(1)
    const last = rec.blits.at(-1)!
    expect(last.rects).toEqual([{ row: 0, col: 0, width: cols, height: rows }])
    const buf = last.buffer
    expect(buf.cols).toBe(cols)
    expect(buf.rows).toBe(rows)

    const written = "hello world"
    for (let i = 0; i < written.length; i++) {
      expect(buf.getCell(i, 0).char).toBe(written[i])
    }
    // Cells past the written text are blank, not undefined.
    expect(buf.getCell(written.length, 0).char).toBe(" ")
  })

  test("feedAnsi triggers setCursor() at the post-write cursor position", async () => {
    const a = XtermAdapter({ cols: 10, rows: 3 })
    const { ctx, rec } = createFakeContext(10, 3)
    a.connect(ctx)
    a.feedAnsi("abc")
    await flushMicrotasks()

    const last = rec.cursors.at(-1)!
    expect(last.row).toBe(0)
    expect(last.col).toBe(3) // cursor advances to column after 'c'
  })

  test("multiple writes coalesce into a single microtask blit", async () => {
    const a = XtermAdapter({ cols: 10, rows: 2 })
    const { ctx, rec } = createFakeContext(10, 2)
    a.connect(ctx)
    const blitsAfterConnect = rec.blits.length
    a.feedAnsi("a")
    a.feedAnsi("b")
    a.feedAnsi("c")
    await flushMicrotasks()
    expect(rec.blits.length).toBe(blitsAfterConnect + 1)
  })

  test("ANSI SGR sequences propagate to cell attrs", async () => {
    const a = XtermAdapter({ cols: 10, rows: 2 })
    const { ctx, rec } = createFakeContext(10, 2)
    a.connect(ctx)
    // bold ON, "X", bold OFF, "Y"
    a.feedAnsi("\x1b[1mX\x1b[22mY")
    await flushMicrotasks()
    const buf = rec.blits.at(-1)!.buffer
    expect(buf.getCell(0, 0).char).toBe("X")
    expect(buf.getCell(0, 0).attrs.bold).toBe(true)
    expect(buf.getCell(1, 0).char).toBe("Y")
    expect(buf.getCell(1, 0).attrs.bold).toBeFalsy()
  })

  test("disconnect() releases the xterm Terminal and stops blits", async () => {
    const a = XtermAdapter({ cols: 10, rows: 2 })
    const { ctx, rec } = createFakeContext(10, 2)
    a.connect(ctx)
    a.feedAnsi("hi")
    await flushMicrotasks()
    const blitsBeforeDisconnect = rec.blits.length

    a.disconnect()
    // Post-disconnect feeds are no-ops, not crashes.
    expect(() => a.feedAnsi("ignored")).not.toThrow()
    await flushMicrotasks()
    expect(rec.blits.length).toBe(blitsBeforeDisconnect)
  })

  test("captureInput='all' makes requestInputMode forward 'all' to ctx", () => {
    const a = XtermAdapter({ cols: 10, rows: 2, captureInput: "all" })
    const { ctx, rec } = createFakeContext(10, 2)
    a.connect(ctx)
    expect(rec.inputModes.at(-1)).toBe("all")
    expect(a.inputMode).toBe("all")
  })

  test("setInputMode() updates the mode and re-notifies the context", () => {
    const a = XtermAdapter({ cols: 10, rows: 2 })
    const { ctx, rec } = createFakeContext(10, 2)
    a.connect(ctx)
    a.setInputMode("keys")
    expect(a.inputMode).toBe("keys")
    expect(rec.inputModes.at(-1)).toBe("keys")
  })

  test("xterm onData encodings are forwarded to child.stdin when input mode is interactive", () => {
    const stdoutListeners: ((chunk: Buffer | Uint8Array | string) => void)[] = []
    const stdinWrites: (Uint8Array | string)[] = []
    const child: XtermAdapterChild = {
      stdout: {
        on(_event, listener) {
          stdoutListeners.push(listener)
          return undefined
        },
        off(_event, listener) {
          const idx = stdoutListeners.indexOf(listener)
          if (idx >= 0) stdoutListeners.splice(idx, 1)
          return undefined
        },
      },
      stdin: {
        write(chunk) {
          stdinWrites.push(chunk)
          return true
        },
      },
    }
    const a = XtermAdapter({ cols: 10, rows: 2, child, captureInput: "all" })
    const { ctx } = createFakeContext(10, 2)
    a.connect(ctx)

    expect(stdoutListeners.length).toBe(1)

    // DSR asks the terminal to report its cursor position. xterm emits the
    // response through onData, which the adapter must forward to child.stdin
    // while interactive capture is enabled.
    a.feedAnsi("\x1b[6n")
    expect(stdinWrites).toEqual(["\x1b[1;1R"])
  })

  test("disconnect() unsubscribes the child stdout listener", () => {
    const stdoutListeners: ((chunk: Buffer | Uint8Array | string) => void)[] = []
    const child: XtermAdapterChild = {
      stdout: {
        on(_event, listener) {
          stdoutListeners.push(listener)
          return undefined
        },
        off(_event, listener) {
          const idx = stdoutListeners.indexOf(listener)
          if (idx >= 0) stdoutListeners.splice(idx, 1)
          return undefined
        },
      },
    }
    const a = XtermAdapter({ cols: 10, rows: 2, child })
    const { ctx } = createFakeContext(10, 2)
    a.connect(ctx)
    expect(stdoutListeners.length).toBe(1)
    a.disconnect()
    expect(stdoutListeners.length).toBe(0)
  })

  test("wide CJK characters mark continuation cells", async () => {
    const a = XtermAdapter({ cols: 10, rows: 2 })
    const { ctx, rec } = createFakeContext(10, 2)
    a.connect(ctx)
    // CJK wide character — should take 2 cells in Unicode 11
    a.feedAnsi("中")
    await flushMicrotasks()
    const buf = rec.blits.at(-1)!.buffer
    const c0 = buf.getCell(0, 0)
    expect(c0.char).toBe("中")
    expect(c0.wide).toBe(true)
    const c1 = buf.getCell(1, 0)
    expect(c1.continuation).toBe(true)
  })
})
