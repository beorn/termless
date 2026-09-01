/**
 * pipe — composition and backpressure.
 *
 * The load-bearing property is that `pipe` **awaits** each `apply`. Without
 * that await the source runs ahead of its sinks, which is exactly the
 * unbounded buffering the io contract promises never happens.
 */

import { describe, expect, test } from "vitest"
import { micros, pipe, type Event, type Sink } from "../../src/io/index.ts"
import { bytes, collect, conformanceEvents, fakeEmulator, text } from "./fixtures.ts"

/** A source that records when each event is produced. */
function tracingSource(log: string[], count: number): AsyncIterable<Event> {
  return {
    async *[Symbol.asyncIterator]() {
      for (let i = 0; i < count; i++) {
        log.push(`produce:${i}`)
        yield { at: micros(i), type: "output", data: bytes(String(i)) } satisfies Event
      }
    },
  }
}

/** A sink whose `apply` really takes time, and records when it finishes. */
function slowSink(log: string[], delayMs: number): Sink {
  let seen = 0
  return {
    async apply(): Promise<void> {
      const index = seen++
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      log.push(`consume:${index}`)
    },
  }
}

describe("pipe", () => {
  test("awaits each apply — a slow sink holds the source back", async () => {
    const log: string[] = []
    const started = Date.now()

    await pipe(tracingSource(log, 4), slowSink(log, 5))

    // Strict alternation is the backpressure property: the source is never
    // pulled again until the sink has finished the previous event. Drop the
    // await in pipe and this becomes produce×4 followed by consume×4.
    expect(log).toEqual([
      "produce:0",
      "consume:0",
      "produce:1",
      "consume:1",
      "produce:2",
      "consume:2",
      "produce:3",
      "consume:3",
    ])

    // …and the slowness is real, not just ordering: four 5ms applies cannot
    // complete in under 15ms if they were actually awaited.
    expect(Date.now() - started).toBeGreaterThanOrEqual(15)
  })

  test("applies every sink in argument order before pulling the next event", async () => {
    const log: string[] = []
    const first: Sink = { apply: (e) => void log.push(`first:${text((e as { data: Uint8Array }).data)}`) }
    const second: Sink = { apply: (e) => void log.push(`second:${text((e as { data: Uint8Array }).data)}`) }

    await pipe(tracingSource([], 2), first, second)

    expect(log).toEqual(["first:0", "second:0", "first:1", "second:1"])
  })

  test("delivers the exit event to every sink", async () => {
    const emulator = fakeEmulator()
    const recorder: Event[] = []

    await pipe(
      (async function* () {
        for (const e of conformanceEvents()) yield e
      })(),
      emulator,
      { apply: (e) => void recorder.push(e) },
    )

    const exits = emulator.applied.filter((e) => e.type === "exit")
    expect(exits).toHaveLength(1)
    expect(exits[0]).toEqual({ at: micros(7_000), type: "exit", code: 0, signal: null })

    // It arrives last — a recording sink finalizes on it, so anything after it
    // would be written past the end of the file.
    expect(emulator.applied[emulator.applied.length - 1]).toBe(exits[0])
    expect(recorder).toEqual([...emulator.applied])
  })

  test("an emulator is structurally a Sink — no adapter between source and screen", async () => {
    const emulator = fakeEmulator()

    await pipe(
      (async function* () {
        for (const e of conformanceEvents()) yield e
      })(),
      emulator,
    )

    expect(emulator.getText()).toBe("hello world")
    expect(emulator.size).toEqual({ cols: 80, rows: 24 })
  })

  test("resolves without touching any sink on an empty source", async () => {
    const log: Event[] = []
    await pipe((async function* (): AsyncGenerator<Event> {})(), { apply: (e) => void log.push(e) })
    expect(log).toEqual([])
  })

  test("a source is drainable independently of pipe", async () => {
    expect(
      await collect(
        (async function* () {
          for (const e of conformanceEvents()) yield e
        })(),
      ),
    ).toHaveLength(8)
  })
})
