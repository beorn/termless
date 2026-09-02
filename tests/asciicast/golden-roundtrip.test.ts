/**
 * Golden round-trip corpus for the asciicast v2 codec.
 *
 * Phase A3 (unterm) converges the `Recording` model and adds `"r"` (resize)
 * events to the `o`/`i`/`m` vocabulary asciicast carries today. Per
 * docs/lessons/refactoring.md's read-old-write-new discipline, this suite
 * pins TODAY's parse/write/decode/encode behaviour as a committed, byte-exact
 * oracle *before* that change lands. See `fixtures/README.md` for what each
 * fixture pins, the canonical-form methodology, and the measured fossils
 * this file asserts.
 *
 * Every fixture under `./fixtures/*.cast` is discovered via `readdir` — a new
 * fixture dropped in that directory is covered automatically, no edit here
 * required. Each is driven through:
 *   (a) parse -> reserialize -> byte-identical to the fixture itself (the
 *       fixture is already in the codebase's own canonical JSON-lines form).
 *   (b) parse -> decodeAsciicast -> encodeAsciicast -> parse reproduces every
 *       non-marker event's type/data and the header's width/height — EXCEPT
 *       a fixture with zero surviving (non-`m`) events, which can't decode
 *       at all (`createRecording` refuses an empty `io` track), so that case
 *       asserts a throw instead of a round trip.
 *   (c) every surviving event's `time` float survives float -> µs -> float
 *       within the MEASURED rounding tolerance (see TIME_TOLERANCE_SECONDS).
 *
 * A separate block below re-reads `02-header-fields.cast` directly to pin
 * exactly which header fields survive that same round trip (none of
 * timestamp/title/env/theme do, by default — README has the measured detail),
 * and a final block pins one explicit "expected fossil": what `parseAsciicast`
 * does TODAY with an `"r"` (resize) event, which this codec does not support
 * yet.
 */
import { describe, test, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseAsciicast } from "../../src/recording/asciicast/reader.ts"
import { decodeAsciicast, encodeAsciicast } from "../../src/recording/asciicast/recording-codec.ts"
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
      const nonMarkerEvents = parsed.events.filter((event) => event.type !== "m")

      test("parse -> reserialize is byte-identical to the committed fixture", () => {
        expect(serializeAsciicast(parsed)).toBe(fixture.text)
      })

      if (nonMarkerEvents.length === 0) {
        test("decodeAsciicast throws — no o/i events survive to populate the io track", () => {
          expect(() => decodeAsciicast(parsed)).toThrow(/non-empty track/)
        })
      } else {
        test("decode -> encode -> parse round-trips every non-marker event's type/data, and width/height", () => {
          const decoded = decodeAsciicast(parsed)
          const reParsed = parseAsciicast(encodeAsciicast(decoded))

          expect(reParsed.header.width).toBe(parsed.header.width)
          expect(reParsed.header.height).toBe(parsed.header.height)
          expect(reParsed.events).toHaveLength(nonMarkerEvents.length)
          for (let i = 0; i < nonMarkerEvents.length; i++) {
            expect(reParsed.events[i]!.type).toBe(nonMarkerEvents[i]!.type)
            expect(reParsed.events[i]!.data).toBe(nonMarkerEvents[i]!.data)
          }
          // Expected fossil (fixtures/README.md): env/theme never survive
          // decode, whatever the source header carried.
          expect(reParsed.header.env).toBeUndefined()
          expect(reParsed.header.theme).toBeUndefined()
        })

        test("every surviving event's time float round-trips within the measured µs-rounding tolerance", () => {
          const decoded = decodeAsciicast(parsed)
          const reParsed = parseAsciicast(encodeAsciicast(decoded))
          for (let i = 0; i < nonMarkerEvents.length; i++) {
            const diff = Math.abs(reParsed.events[i]!.time - nonMarkerEvents[i]!.time)
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

describe('expected fossil — parseAsciicast on a resize ("r") event, TODAY', () => {
  test('passes an "r" event through unchanged instead of throwing or dropping it — A3 will add real r support', () => {
    const content = ['{"version":2,"width":80,"height":24}', '[1.5,"r","100x30"]'].join("\n") + "\n"

    const recording = parseAsciicast(content)
    // TODAY: no runtime validation against the "o" | "i" | "m" union — it is
    // compile-time only, so an "r" tuple survives parsing verbatim.
    expect(recording.events).toHaveLength(1)
    expect(recording.events[0]).toEqual({ time: 1.5, type: "r", data: "100x30" })

    // Bonus, equally measured: decodeAsciicast only filters "m" — an "r"
    // event is NOT dropped, it is silently miscategorized as directional
    // INPUT (`type === "o" ? "out" : "in"` has no third branch).
    const decoded = decodeAsciicast(recording)
    expect(decoded.io).toHaveLength(1)
    expect(decoded.io![0]).toEqual({ at: 1_500_000, direction: "in", data: "100x30" })
  })
})
