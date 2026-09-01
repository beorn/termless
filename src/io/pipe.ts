/**
 * pipe — the whole composition story, in three lines.
 *
 * ```ts
 * pipe(source, ...sinks)   // for await (const e of source) for (const s of sinks) await s.apply(e)
 * ```
 *
 * Every source × sink combination works without an adapter because both sides
 * speak Event: `session.events()` into an emulator is a live screen, into
 * `record(file)` is a recording, into `send(stream)` is a broadcast — and
 * `replay(rec)` substitutes for any of them.
 *
 * **Backpressure is the pull side doing its job.** `for await` never pulls the
 * next event until the loop body's awaits resolve, and the loop body awaits
 * every `apply`. A slow sink therefore slows the source; nothing buffers
 * without bound and nothing is dropped. Fan-out to sinks of *different* speeds
 * is a Web Streams problem, which is what the bridges below are for.
 */

import type { Event } from "./event.ts"
import type { Sink, Source } from "./session.ts"

/**
 * Drive every Event from `source` through every sink, in order, awaiting each
 * `apply`.
 *
 * Resolves when the source is exhausted. Sinks are applied in argument order
 * for each event before the next event is pulled, so a recording sink and an
 * emulator observe the same causal order.
 */
export async function pipe(source: Source, ...sinks: Sink[]): Promise<void> {
  for await (const e of source) {
    for (const sink of sinks) {
      await sink.apply(e)
    }
  }
}

/**
 * Bridge a {@link Source} to a Web {@link ReadableStream} of Events.
 *
 * Use it to reach the platform's own plumbing — `tee()` for fan-out to sinks
 * of different speeds, `pipeThrough()` for transforms. The stream pulls one
 * event at a time, so the source stays under the consumer's control exactly as
 * it is under {@link pipe}'s.
 */
export function toReadable(source: Source): ReadableStream<Event> {
  let iterator: AsyncIterator<Event> | null = null

  return new ReadableStream<Event>({
    async pull(controller) {
      iterator ??= source[Symbol.asyncIterator]()
      const next = await iterator.next()
      if (next.done === true) {
        controller.close()
        return
      }
      controller.enqueue(next.value)
    },
    async cancel(reason) {
      await iterator?.return?.(reason)
    },
  })
}

/**
 * Bridge a Web {@link ReadableStream} of Events back to a {@link Source}.
 *
 * The inverse of {@link toReadable}: whatever came out of a `tee()` or a
 * `pipeThrough()` becomes something {@link pipe} can drive again. Reads one
 * event at a time and releases the reader when iteration ends or is abandoned.
 */
export function fromReadable(stream: ReadableStream<Event>): Source {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<Event> {
      const reader = stream.getReader()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) return
          yield value
        }
      } finally {
        reader.releaseLock()
      }
    },
  }
}
