/**
 * toReadable / fromReadable — the Web Streams bridges.
 *
 * The core contract stays three lines because fan-out to sinks of different
 * speeds and platform interop go through the platform's own plumbing instead.
 * These tests prove the two directions compose and that the round trip is
 * lossless.
 */

import { describe, expect, test } from "vitest"
import { fromReadable, micros, pipe, toReadable, type Event } from "../../src/io/index.ts"
import { bytes, collect, conformanceEvents, fakeEmulator } from "./fixtures.ts"

function source(events: Event[] = conformanceEvents()): AsyncIterable<Event> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e
    },
  }
}

describe("Web Streams bridges", () => {
  test("round-trips a stream unchanged", async () => {
    const events = conformanceEvents()
    expect(await collect(fromReadable(toReadable(source(events))))).toEqual(events)
  })

  test("a round-tripped source still drives pipe", async () => {
    const emulator = fakeEmulator()
    await pipe(fromReadable(toReadable(source())), emulator)

    expect(emulator.getText()).toBe("hello world")
    expect(emulator.applied).toHaveLength(8)
  })

  test("toReadable pulls lazily — it does not drain the source up front", async () => {
    const produced: number[] = []
    const lazy: AsyncIterable<Event> = {
      async *[Symbol.asyncIterator]() {
        for (let i = 0; i < 5; i++) {
          produced.push(i)
          yield { at: micros(i), type: "output", data: bytes(String(i)) } satisfies Event
        }
      },
    }

    const reader = toReadable(lazy).getReader()
    await reader.read()
    // One pull, one event produced — an eager bridge would show all five here.
    expect(produced).toEqual([0])

    await reader.read()
    expect(produced).toEqual([0, 1])

    await reader.cancel()
  })

  test("tee fans one source out to two consumers — the reason the bridges exist", async () => {
    const [left, right] = toReadable(source()).tee()

    const [a, b] = await Promise.all([collect(fromReadable(left)), collect(fromReadable(right))])

    expect(a).toEqual(conformanceEvents())
    expect(b).toEqual(a)
  })

  test("an empty source becomes an immediately-closing stream", async () => {
    expect(await collect(fromReadable(toReadable(source([]))))).toEqual([])
  })
})
