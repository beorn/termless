/**
 * xtermGuest IslandGuest contract tests.
 *
 * Phase 2 of @km/silvery/15646-islands ports the old XtermAdapter
 * ForeignSource into the generic IslandGuest shape while keeping the
 * Viewport adapter as a deprecated shim.
 */

import { describe, expect, test } from "vitest"

import { xtermGuest, type XtermGuestChild, type XtermGuestHandle } from "../../packages/xtermjs/src/index.ts"
import type { IslandContext, IslandHandle } from "../../packages/xtermjs/src/silvery-compat.ts"

function createContext(cols: number, rows: number): IslandContext {
  const controller = new AbortController()
  return {
    cols,
    rows,
    emit: () => {},
    requestResize: () => {},
    execOSC: async () => undefined,
    abortSignal: controller.signal,
    now: () => 0,
  }
}

function createChild(): XtermGuestChild & {
  emitStdout(chunk: Uint8Array | string): void
  stdinWrites: string[]
  resizes: { cols: number; rows: number }[]
  signals: Array<string | number>
} {
  let stdoutListener: ((chunk: Uint8Array | string) => void) | null = null
  const stdinWrites: string[] = []
  const resizes: { cols: number; rows: number }[] = []
  const signals: Array<string | number> = []
  return {
    stdout: {
      on(event, listener) {
        if (event === "data") stdoutListener = listener
        return undefined
      },
      off(event, listener) {
        if (event === "data" && stdoutListener === listener) stdoutListener = null
        return undefined
      },
    },
    write(data) {
      stdinWrites.push(data)
    },
    resize(cols, rows) {
      resizes.push({ cols, rows })
    },
    kill(signal) {
      signals.push(signal ?? "SIGTERM")
    },
    close: async () => undefined,
    emitStdout(chunk) {
      stdoutListener?.(chunk)
    },
    stdinWrites,
    resizes,
    signals,
  }
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** The first row's text, read back through the same cell accessor a consumer uses. */
function rowText(handle: IslandHandle): string {
  const buffer = handle.output.buffer
  let line = ""
  for (let col = 0; col < buffer.cols; col++) line += buffer.getCell(col, 0).char
  return line.trimEnd()
}

describe("xtermGuest", () => {
  test("declares island capabilities and returns the six sub-owner surface", async () => {
    const child = createChild()
    const guest = xtermGuest({ child, cols: 20, rows: 4 })
    expect(guest.capabilities).toEqual({ input: true, modes: true, resize: true })

    const handle = await guest.init(createContext(20, 4))

    expect(handle.size.cols).toBe(20)
    expect(handle.size.rows).toBe(4)
    expect(handle.output.buffer.cols).toBe(20)
    expect(handle.input?.feed).toBeTypeOf("function")
    expect(handle.input?.sendEof).toBeTypeOf("function")
    expect(handle.input?.onKey).toBeTypeOf("function")
    expect(handle.input?.onMouse).toBeTypeOf("function")
    expect(handle.input?.onPaste).toBeTypeOf("function")
    expect(handle.modes?.modes).toMatchObject({
      bracketedPaste: true,
      kittyKeyboard: true,
      mouseTracking: "off",
      focusReporting: true,
    })
    expect(handle.signals?.sendSigint).toBeTypeOf("function")
    expect(handle.signals?.sendSigtstp).toBeTypeOf("function")
    expect(handle.signals?.sendSigterm).toBeTypeOf("function")
    expect(handle.signals?.sendSigkill).toBeTypeOf("function")

    await handle.dispose()
  })

  test("tracks mouse reporting mode from child DECSET output", async () => {
    const child = createChild()
    const handle = await xtermGuest({ child, cols: 10, rows: 2 }).init(createContext(10, 2))
    const notifications: Array<NonNullable<typeof handle.modes>["modes"]["mouseTracking"]> = []
    handle.modes!.subscribe((modes) => {
      notifications.push(modes.mouseTracking)
    })

    expect(handle.modes!.modes.mouseTracking).toBe("off")

    child.emitStdout("\x1b[?1000h")
    expect(handle.modes!.modes.mouseTracking).toBe("click")

    child.emitStdout("\x1b[?1002h")
    expect(handle.modes!.modes.mouseTracking).toBe("drag")

    child.emitStdout("\x1b[?1003h")
    expect(handle.modes!.modes.mouseTracking).toBe("any")

    child.emitStdout("\x1b[?1003l")
    expect(handle.modes!.modes.mouseTracking).toBe("drag")

    child.emitStdout("\x1b[?1000;1002l")
    expect(handle.modes!.modes.mouseTracking).toBe("off")
    expect(notifications).toEqual(["click", "drag", "any", "drag", "off"])

    await handle.dispose()
  })

  test("child stdout updates output buffer and notifies subscribers", async () => {
    const child = createChild()
    const handle = await xtermGuest({ child, cols: 10, rows: 2 }).init(createContext(10, 2))
    let paints = 0
    const unsubscribe = handle.output.subscribe(() => {
      paints += 1
    })

    child.emitStdout("hello")
    await flushMicrotasks()

    expect(paints).toBe(1)
    expect(handle.output.buffer.getCell(0, 0).char).toBe("h")
    expect(handle.output.buffer.getCell(4, 0).char).toBe("o")
    expect(handle.output.cursor).toEqual({ row: 0, col: 5, style: "block" })
    expect(handle.output.cursorVisible).toBe(true)

    unsubscribe()
    await handle.dispose()
  })

  test("a character split across two stdout chunks renders whole (termless issue 10)", async () => {
    const child = createChild()
    const handle = await xtermGuest({ child, cols: 20, rows: 2 }).init(createContext(20, 2))
    const line = Buffer.from("Café 日本")
    const cut = line.indexOf(0xe6) + 1

    child.emitStdout(line.subarray(0, cut))
    child.emitStdout(line.subarray(cut))
    await flushMicrotasks()

    expect(rowText(handle)).toBe("Café 日本")
    await handle.dispose()
  })

  test("the same bytes in one chunk render the same text (termless issue 10 control)", async () => {
    const child = createChild()
    const handle = await xtermGuest({ child, cols: 20, rows: 2 }).init(createContext(20, 2))

    child.emitStdout(Buffer.from("Café 日本"))
    await flushMicrotasks()

    expect(rowText(handle)).toBe("Café 日本")
    await handle.dispose()
  })

  test("input feeding cannot flush the output decoder half character (termless issue 10)", async () => {
    const child = createChild()
    const handle = await xtermGuest({ child, cols: 20, rows: 2 }).init(createContext(20, 2))
    const line = Buffer.from("日本")

    child.emitStdout(line.subarray(0, 2))
    const feed = handle.input?.feed
    if (!feed) throw new Error("the guest declares an input feed")
    feed.call(handle.input, new Uint8Array([0x78]))
    child.emitStdout(line.subarray(2))
    await flushMicrotasks()

    expect(rowText(handle)).toBe("日本")
    expect(child.stdinWrites, "the input path still writes exactly what it was handed").toEqual(["x"])
    await handle.dispose()
  })

  test("a truncated trailing character is flushed on dispose instead of being dropped (termless issue 10)", async () => {
    const child = createChild()
    const handle = await xtermGuest({ child, cols: 10, rows: 2 }).init(createContext(10, 2))

    child.emitStdout(Buffer.from("A"))
    child.emitStdout(Buffer.from([0xe6, 0x97]))
    await flushMicrotasks()

    expect(rowText(handle), "a half character mid-stream must not be invented as U+FFFD").toBe("A")

    await handle.dispose()

    expect(rowText(handle), "the retained tail must surface at teardown, not vanish").toBe("A\uFFFD")
  })

  test("coalesces async stdout bursts when an output window is configured", async () => {
    const child = createChild()
    const handle = await xtermGuest({
      child,
      cols: 10,
      rows: 2,
      outputCoalesceMs: 5,
    }).init(createContext(10, 2))
    let paints = 0
    handle.output.subscribe(() => {
      paints += 1
    })

    child.emitStdout("a")
    await flushMicrotasks()
    child.emitStdout("b")
    await flushMicrotasks()
    child.emitStdout("c")
    await flushMicrotasks()

    expect(paints, "separate async chunks should not each force an island paint inside the coalesce window").toBe(0)

    await sleep(15)

    expect(paints).toBe(1)
    expect(handle.output.buffer.getCell(0, 0).char).toBe("a")
    expect(handle.output.buffer.getCell(1, 0).char).toBe("b")
    expect(handle.output.buffer.getCell(2, 0).char).toBe("c")

    child.emitStdout("d")
    await sleep(15)

    expect(paints).toBe(2)
    expect(handle.output.buffer.getCell(3, 0).char).toBe("d")

    await handle.dispose()
  })

  test("scrollViewport moves through xterm scrollback without writing mouse bytes to the child", async () => {
    const child = createChild()
    const handle = (await xtermGuest({ child, cols: 10, rows: 2, scrollback: 20 }).init(
      createContext(10, 2),
    )) as XtermGuestHandle
    let paints = 0
    handle.output.subscribe(() => {
      paints += 1
    })

    child.emitStdout("line-0\r\nline-1\r\nline-2\r\nline-3")
    await flushMicrotasks()

    expect(handle.output.buffer.getCell(0, 0).char).toBe("l")
    expect(handle.output.buffer.getCell(5, 0).char).toBe("2")
    expect(handle.output.buffer.getCell(5, 1).char).toBe("3")
    const atTail = handle.getScrollback()
    expect(atTail.screenLines).toBe(2)
    expect(atTail.totalLines).toBeGreaterThan(2)

    handle.scrollViewport(-1)
    const afterScroll = handle.getScrollback()

    expect(handle.output.buffer.getCell(5, 0).char).toBe("1")
    expect(handle.output.buffer.getCell(5, 1).char).toBe("2")
    expect(afterScroll.viewportOffset).toBeLessThan(atTail.viewportOffset)
    expect(afterScroll.totalLines).toBe(atTail.totalLines)
    expect(child.stdinWrites, "local viewport scroll must not send SGR mouse bytes to the child").toEqual([])
    expect(paints).toBeGreaterThanOrEqual(2)

    await handle.dispose()
  })

  test("forwards terminal query replies back to the PTY child", async () => {
    const child = createChild()
    const handle = await xtermGuest({ child, cols: 10, rows: 2 }).init(createContext(10, 2))

    child.emitStdout("\x1b[6n")

    expect(child.stdinWrites).toEqual(["\x1b[1;1R"])

    await handle.dispose()
  })

  test("size.requestResize resizes child and mirror before notifying size/output subscribers", async () => {
    const child = createChild()
    const handle = await xtermGuest({ child, cols: 10, rows: 2 }).init(createContext(10, 2))
    const sizes: { cols: number; rows: number }[] = []
    let outputNotifications = 0
    handle.size.subscribe((size) => sizes.push(size))
    handle.output.subscribe(() => {
      outputNotifications += 1
    })

    handle.size.requestResize(12, 3)

    expect(child.resizes).toEqual([{ cols: 12, rows: 3 }])
    expect(handle.size.cols).toBe(12)
    expect(handle.size.rows).toBe(3)
    expect(handle.output.buffer.cols).toBe(12)
    expect(handle.output.buffer.rows).toBe(3)
    expect(sizes).toEqual([{ cols: 12, rows: 3 }])
    expect(outputNotifications).toBe(1)

    await handle.dispose()
  })

  test("input feed/sendEof and signals forward to the PTY child", async () => {
    const child = createChild()
    const handle = await xtermGuest({ child, cols: 10, rows: 2 }).init(createContext(10, 2))

    handle.input!.feed!(new TextEncoder().encode("abc"))
    handle.input!.sendEof!()
    handle.signals!.sendSigint()
    handle.signals!.sendSigtstp()
    handle.signals!.sendSigterm()
    handle.signals!.sendSigkill()

    expect(child.stdinWrites).toEqual(["abc", "\x04"])
    expect(child.signals).toEqual(["SIGINT", "SIGTSTP", "SIGTERM", "SIGKILL"])

    await handle.dispose()
  })
})
