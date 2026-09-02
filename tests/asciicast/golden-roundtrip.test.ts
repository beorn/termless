/**
 * Golden round-trip corpus for the asciicast v2 codec.
 *
 * Phase A3 (unterm) converges the `Recording` model. Slices 1-3 laid the
 * groundwork; **slice 4 adds `"r"` (resize) to the `o`/`i`/`m` vocabulary**
 * via a new io-shaped pair, `readAsciicast`/`writeAsciicast`
 * (`../../src/recording/asciicast/io-codec.ts`) — see the io-pair block
 * below. The original per-fixture blocks in this file still pin the
 * DEPRECATED `Trace`-shaped `decodeAsciicast`/`encodeAsciicast` per
 * docs/lessons/refactoring.md's read-old-write-new discipline, now measured
 * against the corpus including the new resize fixture. See
 * `fixtures/README.md` for what each fixture pins, the canonical-form
 * methodology, and the measured fossils this file asserts.
 *
 * Every fixture under `./fixtures/*.cast` is discovered via `readdir` — a new
 * fixture dropped in that directory is covered automatically, no edit here
 * required. Each is driven through:
 *   (a) parse -> reserialize -> byte-identical to the fixture itself (the
 *       fixture is already in the codebase's own canonical JSON-lines form).
 *   (b) parse -> decodeAsciicast -> encodeAsciicast -> parse reproduces every
 *       event the DEPRECATED door can carry (o/i only — `traceFromRecording`
 *       has no `io`-track row shape for `mark` OR `control`, so both `"m"`
 *       and, as of slice 4, `"r"` are dropped on that door) and the header's
 *       width/height — EXCEPT a fixture with zero surviving (o/i) events,
 *       which can't decode at all (`traceFromRecording` refuses when nothing
 *       survives into the `io` track), so that case asserts a throw instead
 *       of a round trip.
 *   (c) every surviving event's `time` float survives float -> µs -> float
 *       within the MEASURED rounding tolerance (see TIME_TOLERANCE_SECONDS).
 *
 * A separate block below re-reads `02-header-fields.cast` directly to pin
 * exactly which header fields survive that same DEPRECATED round trip (none
 * of timestamp/title/env/theme do, by default — README has the measured
 * detail); an io-pair block proves the NEW `readAsciicast`/`writeAsciicast`
 * door is the *symmetric* `.cast` codec — `writeAsciicast(readAsciicast(x))`
 * is byte-identical to `x` for every fixture, no exceptions, unlike the
 * deprecated door's several documented losses; and a final block pins one
 * explicit "expected fossil" — now the POST-slice-4 truth about a resize
 * event on each door, superseding what used to be measured there
 * (parseAsciicast passing an unvalidated `"r"` through and decodeAsciicast
 * mis-filing it as input).
 */
import { describe, test, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseAsciicast } from "../../src/recording/asciicast/reader.ts"
import { decodeAsciicast, encodeAsciicast } from "../../src/recording/asciicast/recording-codec.ts"
import { readAsciicast, writeAsciicast } from "../../src/recording/asciicast/io-codec.ts"
import { traceFromRecording } from "../../src/recording/trace-bridges.ts"
import type { AsciicastRecording } from "../../src/recording/asciicast/types.ts"

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures")

/**
 * The codebase's own canonical serialization, generalized to a full parsed
 * `AsciicastRecording` — see fixtures/README.md "Canonical form" for why
 * neither real writer (`createAsciicastWriter`, `encodeAsciicast`) can do
 * this job directly. Used ONLY to prove a fixture is already byte-stable
 * under the convention every writer here actually uses: `JSON.stringify` the
 * header, then one `JSON.stringify([time, type, data])` line per event,
 * `\n`-joined, trailing `\n`.
 */
function serializeAsciicast(recording: AsciicastRecording): string {
  const lines = [JSON.stringify(recording.header)]
  for (const event of recording.events) {
    lines.push(JSON.stringify([event.time, event.type, event.data]))
  }
  return lines.join("\n") + "\n"
}

interface Fixture {
  name: string
  text: string
}

function loadFixtures(): Fixture[] {
  return readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith(".cast"))
    .sort()
    .map((name) => ({ name, text: readFileSync(join(FIXTURES_DIR, name), "utf8") }))
}

const fixtures = loadFixtures()

/**
 * Max error introduced by asciicast's float-seconds -> integer-µs ->
 * float-seconds round trip. `secondsToMicros` rounds to the nearest µs — a
 * theoretical bound of 0.5µs = 5e-7s. Measured end-to-end through the real
 * parse -> decode -> encode -> parse pipeline on an adversarial input sitting
 * exactly on that boundary (`2.9999995`, in `05-timing-edges.cast`):
 *
 *   orig=2.9999995  back=3  diff=5.00000000069889e-7
 *
 * The tiny excess over 5e-7 is float64 representation noise on 2.9999995
 * itself, not additional rounding error. Set with headroom above the
 * measured bound, not tight to it.
 */
const TIME_TOLERANCE_SECONDS = 1e-6

describe("asciicast golden corpus", () => {
  test("the corpus is actually present (a silent zero would prove nothing)", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(6)
  })

  for (const fixture of fixtures) {
    describe(fixture.name, () => {
      const parsed = parseAsciicast(fixture.text)
      // Events the DEPRECATED Trace-shaped door (decodeAsciicast/
      // encodeAsciicast) can actually carry. traceFromRecording
      // (../../src/recording/trace-bridges.ts) has no `io`-track row shape
      // for `mark` or `control` — and `control` is what an `"r"` resize event
      // becomes on read, as of slice 4 — so both `"m"` and `"r"` are dropped
      // on this door, not just `"m"`. The io-shaped door (readAsciicast/
      // writeAsciicast) carries every well-formed event with no filtering at
      // all — proved separately in the io-pair block below.
      const deprecatedPathEvents = parsed.events.filter((event) => event.type !== "m" && event.type !== "r")

      test("parse -> reserialize is byte-identical to the committed fixture", () => {
        expect(serializeAsciicast(parsed)).toBe(fixture.text)
      })

      if (deprecatedPathEvents.length === 0) {
        test("decodeAsciicast throws — no o/i events survive to populate the io track", () => {
          // Post-slice-4: decodeAsciicast composes readAsciicast +
          // traceFromRecording; the throw now comes from traceFromRecording's
          // "no survivors" guard (../../src/recording/trace-bridges.ts), not
          // createRecording's old "non-empty track" message — same failure
          // (nothing to populate an `io` track with), new text, and now also
          // reachable by an all-resize input, not just all-marker/empty.
          expect(() => decodeAsciicast(parsed)).toThrow(/no output\/input events survived/)
        })
      } else {
        test("decode -> encode -> parse round-trips every o/i event's type/data, and width/height", () => {
          const decoded = decodeAsciicast(parsed)
          const reParsed = parseAsciicast(encodeAsciicast(decoded))

          expect(reParsed.header.width).toBe(parsed.header.width)
          expect(reParsed.header.height).toBe(parsed.header.height)
          expect(reParsed.events).toHaveLength(deprecatedPathEvents.length)
          for (let i = 0; i < deprecatedPathEvents.length; i++) {
            expect(reParsed.events[i]!.type).toBe(deprecatedPathEvents[i]!.type)
            expect(reParsed.events[i]!.data).toBe(deprecatedPathEvents[i]!.data)
          }
          // Expected fossil (fixtures/README.md): env/theme never survive
          // decode, whatever the source header carried.
          expect(reParsed.header.env).toBeUndefined()
          expect(reParsed.header.theme).toBeUndefined()
        })

        test("every surviving event's time float round-trips within the measured µs-rounding tolerance", () => {
          const decoded = decodeAsciicast(parsed)
          const reParsed = parseAsciicast(encodeAsciicast(decoded))
          for (let i = 0; i < deprecatedPathEvents.length; i++) {
            const diff = Math.abs(reParsed.events[i]!.time - deprecatedPathEvents[i]!.time)
            expect(diff).toBeLessThanOrEqual(TIME_TOLERANCE_SECONDS)
          }
        })
      }
    })
  }
})

describe("header field survival through the io-track round trip (measured against 02-header-fields.cast)", () => {
  const rich = fixtures.find((fixture) => fixture.name === "02-header-fields.cast")

  test("fixture 02 actually carries timestamp/title/env/theme, or the rest of this block proves nothing", () => {
    expect(rich).toBeDefined()
    const header = parseAsciicast(rich!.text).header
    expect(header.timestamp).toBeDefined()
    expect(header.title).toBeDefined()
    expect(header.env).toBeDefined()
    expect(header.theme).toBeDefined()
  })

  test("decodeAsciicast drops timestamp/title/env/theme — none reach the Recording itself", () => {
    const decoded = decodeAsciicast(parseAsciicast(rich!.text))
    // hasOwnProperty, not a type-level check: types are erased at runtime,
    // and "does the object carry this key at all" is exactly the fact type
    // erasure could otherwise hide.
    for (const key of ["timestamp", "title", "env", "theme"]) {
      expect(Object.prototype.hasOwnProperty.call(decoded, key)).toBe(false)
    }
  })

  test("title/timestamp CAN be restored via EncodeAsciicastOptions if the caller re-supplies them", () => {
    const parsed = parseAsciicast(rich!.text)
    const decoded = decodeAsciicast(parsed)
    const reParsed = parseAsciicast(
      encodeAsciicast(decoded, { title: parsed.header.title, timestamp: parsed.header.timestamp }),
    )
    expect(reParsed.header.title).toBe(parsed.header.title)
    expect(reParsed.header.timestamp).toBe(parsed.header.timestamp)
  })

  test("env/theme are not restorable by anyone — EncodeAsciicastOptions has no field for either", () => {
    // Not just "unset by default": `EncodeAsciicastOptions` is
    // `{ title?: string; timestamp?: number }`, so there is no call shape
    // that could even attempt to pass env/theme through — that absence is a
    // type-level fact (documented in fixtures/README.md) rather than
    // something a runtime assertion can observe. What IS observable, and
    // asserted here, is that the round trip carries neither through.
    const decoded = decodeAsciicast(parseAsciicast(rich!.text))
    const reParsed = parseAsciicast(encodeAsciicast(decoded))
    expect(reParsed.header.env).toBeUndefined()
    expect(reParsed.header.theme).toBeUndefined()
  })

  test("encodeAsciicast always emits a duration field, even when the source header had none", () => {
    const minimal = fixtures.find((fixture) => fixture.name === "01-minimal.cast")
    expect(minimal).toBeDefined()
    const parsed = parseAsciicast(minimal!.text)
    expect(parsed.header.duration).toBeUndefined()

    const decoded = decodeAsciicast(parsed)
    const reParsed = parseAsciicast(encodeAsciicast(decoded))
    expect(typeof reParsed.header.duration).toBe("number")
  })
})

describe("io-pair round trip — readAsciicast/writeAsciicast are the symmetric .cast codec", () => {
  // 05-timing-edges.cast carries one deliberately adversarial timestamp,
  // 2.9999995s, chosen (see "Timing tolerance" in fixtures/README.md) to sit
  // exactly on the secondsToMicros rounding boundary
  // (2.9999995 * 1_000_000 = 2999999.5 exactly). It necessarily rounds to
  // 3_000_000µs = 3s on the way through the integer-µs timebase — a property
  // of secondsToMicros/the timebase itself, shared by the deprecated codec
  // (its own per-fixture block above asserts time within a tolerance, never
  // byte-identical time, for exactly this reason) and unrelated to anything
  // this pair drops or fabricates. It is the one fixture in the corpus built
  // specifically to exercise that boundary, so it is the one fixture where
  // literal text byte-identity cannot hold for ANY codec built on this
  // timebase — verified separately below rather than silently excluded.
  const fixturesExceptTimingEdges = fixtures.filter((fixture) => fixture.name !== "05-timing-edges.cast")

  test("the timing-edges fixture is actually present, or the exclusion below excludes nothing", () => {
    expect(fixtures.some((fixture) => fixture.name === "05-timing-edges.cast")).toBe(true)
  })

  for (const fixture of fixturesExceptTimingEdges) {
    test(`${fixture.name}: writeAsciicast(readAsciicast(text)) is byte-identical, drop tally zero`, () => {
      // The strong property this pair is FOR (unlike the deprecated door,
      // which loses markers, resizes, and every optional header field except
      // duration — see the blocks above): text in equals text out, for every
      // fixture whose timestamps are already exact at µs precision (all but
      // one, handled just below), including 08-header-only.cast (no
      // non-empty-track invariant on the io Recording type, so this door
      // doesn't even need to throw) and 09-resize.cast (r survives as a real
      // control/resize Event rather than being dropped or mis-filed).
      // asciicast v2 makes `duration` optional and `writeAsciicast` never
      // fabricates one (see io-codec.ts), so a fixture that never declared
      // one round-trips to text that still doesn't.
      const { text, dropped } = writeAsciicast(readAsciicast(fixture.text))
      expect(text).toBe(fixture.text)
      expect(dropped).toEqual({ mode: 0, signal: 0, exit: 0 })
    })
  }

  test("05-timing-edges.cast: byte-identical everywhere except the one line built to force µs rounding", () => {
    const fixture = fixtures.find((f) => f.name === "05-timing-edges.cast")!
    const { text, dropped } = writeAsciicast(readAsciicast(fixture.text))
    expect(dropped).toEqual({ mode: 0, signal: 0, exit: 0 })

    const originalLines = fixture.text.split("\n")
    const roundTrippedLines = text.split("\n")
    expect(roundTrippedLines).toHaveLength(originalLines.length)
    const differingLineIndexes = originalLines
      .map((line, i) => (line === roundTrippedLines[i] ? -1 : i))
      .filter((i) => i !== -1)

    // Exactly the one adversarial line differs — every other line, including
    // the header and the sub-microsecond-delta event right before it, is
    // still byte-identical.
    expect(differingLineIndexes).toEqual([4])
    expect(originalLines[4]).toBe('[2.9999995,"o","boundary-precision-rounding\\r\\n"]')
    expect(roundTrippedLines[4]).toBe('[3,"o","boundary-precision-rounding\\r\\n"]')
  })
})

describe('expected fossil — a resize ("r") event, after unterm A3 slice 4', () => {
  test('parseAsciicast now validates "r" as a known code; readAsciicast turns it into a control/resize Event; the deprecated decode drops it (with a tally) instead of mis-filing it as input', () => {
    const content = ['{"version":2,"width":80,"height":24}', '[0,"o","$ "]', '[1.5,"r","100x30"]'].join("\n") + "\n"

    // Pre-slice-4, this test's title named a DIFFERENT fossil: parseAsciicast
    // passed an "r" tuple through unvalidated (no runtime check against the
    // "o"|"i"|"m" union), and decodeAsciicast silently miscategorized it as
    // directional INPUT (`type === "o" ? "out" : "in"` had no third branch).
    // Slice 4 replaces both: "r" is now a validated, known code, and it
    // means something real — a resize — all the way through.
    const recording = parseAsciicast(content)
    expect(recording.events).toHaveLength(2)
    expect(recording.events[1]).toEqual({ time: 1.5, type: "r", data: "100x30" })

    // readAsciicast (the new io-shaped door): "r" is a control/resize Event,
    // not directional input.
    const io = readAsciicast(recording)
    expect(io.events[1]).toEqual({
      at: 1_500_000,
      type: "control",
      control: "resize",
      size: { cols: 100, rows: 30 },
    })

    // decodeAsciicast (the deprecated Trace-shaped door): composes
    // readAsciicast with traceFromRecording, which has no `io`-track row
    // shape for `control` — so the resize is DROPPED, the same treatment as
    // a marker, rather than mis-filed as input. (A cast with ONLY the resize
    // event would throw instead — see "decodeAsciicast throws" above — so
    // this fixture keeps the leading "o" event to stay in the
    // round-trippable branch and show the drop cleanly.)
    const decoded = decodeAsciicast(recording)
    expect(decoded.io).toHaveLength(1)
    expect(decoded.io![0]).toEqual({ at: 0, direction: "out", data: "$ " })

    // The tally itself: decodeAsciicast's Trace-shaped return has nowhere to
    // carry it, but traceFromRecording (what decodeAsciicast composes) computes
    // one internally — calling it directly here shows the resize was counted,
    // not silently vanished.
    const { trace, dropped } = traceFromRecording(io)
    expect(dropped).toEqual({ control: 1, mark: 0, exit: 0 })
    expect(trace.io).toHaveLength(1)
  })
})
