import { describe, expect, test, vi } from "vitest"
import { compilePlaybackSource, createPlaybackController } from "../src/index.ts"
import type { PlaybackEvent } from "../src/index.ts"

describe("compilePlaybackSource", () => {
  test("compiles asciicast v2 output, input, marker, and dimensions", () => {
    const cast = [
      '{"version":2,"width":12,"height":4,"duration":2.5,"title":"Demo"}',
      '[0,"o","$ "]',
      '[0.25,"i","ls\\n"]',
      '[0.5,"o","file.txt\\r\\n"]',
      '[1.25,"m","done"]',
    ].join("\n")

    const compiled = compilePlaybackSource(cast, { filename: "demo.cast" })

    expect(compiled.format).toBe("asciicast")
    expect(compiled.cols).toBe(12)
    expect(compiled.rows).toBe(4)
    expect(compiled.durationMs).toBe(2500)
    expect(compiled.title).toBe("Demo")
    expect(compiled.events).toEqual([
      { at: 0, type: "resize", cols: 12, rows: 4 },
      { at: 0, type: "output", data: "$ " },
      { at: 250, type: "input", data: "ls\n", visible: false },
      { at: 500, type: "output", data: "file.txt\r\n" },
      { at: 1250, type: "marker", label: "done" },
    ])
  })

  test("compiles tape commands into local-echo playback without showing hidden setup", () => {
    const tape = `
Set Width 40
Set Height 10
Type@100ms "ab"
Sleep 250ms
Enter
Hide
Type "secret"
Show
Type "ok"
`

    const compiled = compilePlaybackSource(tape, { filename: "demo.tape" })

    expect(compiled.format).toBe("tape")
    expect(compiled.cols).toBe(40)
    expect(compiled.rows).toBe(10)
    expect(compiled.events.filter((event) => event.type === "output")).toEqual([
      { at: 0, type: "output", data: "a" },
      { at: 100, type: "output", data: "b" },
      { at: 450, type: "output", data: "\r\n" },
      { at: 800, type: "output", data: "o" },
      { at: 850, type: "output", data: "k" },
    ])
    const hiddenInputs = compiled.events.filter(
      (event): event is Extract<PlaybackEvent, { type: "input" }> => event.type === "input" && event.visible === false,
    )
    expect(hiddenInputs.map((event) => event.data).join("")).toBe("secret")
  })
})

describe("createPlaybackController", () => {
  test("plays compiled events to an embeddable terminal sink", async () => {
    const sink = {
      reset: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    }
    const controller = createPlaybackController(
      {
        format: "asciicast",
        cols: 5,
        rows: 2,
        durationMs: 200,
        events: [
          { at: 0, type: "resize", cols: 5, rows: 2 },
          { at: 100, type: "output", data: "a" },
          { at: 200, type: "output", data: "b" },
        ],
        warnings: [],
      },
      sink,
    )

    await controller.play({ speed: Infinity })

    expect(sink.reset).toHaveBeenCalledTimes(1)
    expect(sink.resize).toHaveBeenCalledWith(5, 2)
    expect(sink.write).toHaveBeenNthCalledWith(1, "a")
    expect(sink.write).toHaveBeenNthCalledWith(2, "b")
    expect(controller.state()).toMatchObject({ status: "ended", currentTimeMs: 200 })
  })

  test("seeks by reconstructing terminal output without replaying input callbacks", async () => {
    const sink = {
      reset: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    }
    const onInput = vi.fn()
    const controller = createPlaybackController(
      {
        format: "tape",
        cols: 5,
        rows: 2,
        durationMs: 200,
        events: [
          { at: 0, type: "resize", cols: 5, rows: 2 },
          { at: 50, type: "input", data: "a", visible: true },
          { at: 50, type: "output", data: "a" },
          { at: 150, type: "output", data: "b" },
        ],
        warnings: [],
      },
      sink,
      { onInput },
    )

    await controller.seek(100)

    expect(sink.reset).toHaveBeenCalledTimes(1)
    expect(sink.write).toHaveBeenCalledTimes(1)
    expect(sink.write).toHaveBeenCalledWith("a")
    expect(onInput).not.toHaveBeenCalled()
    expect(controller.state()).toMatchObject({ status: "idle", currentTimeMs: 100 })
  })
})
