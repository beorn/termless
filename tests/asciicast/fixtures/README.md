# asciicast golden corpus

Committed `.cast` files that pin **today's** asciicast v2 parse/write/decode/encode
behaviour byte-for-byte, before phase A3 (unterm) converges the `Recording` model
and adds `"r"` (resize) events to the `o`/`i`/`m` vocabulary this codec carries
today. Read alongside `../golden-roundtrip.test.ts`, which discovers every
`*.cast` file here via `readdir` — dropping a new fixture in this directory
gets it covered automatically, no test-file edit required.

## Canonical form — why these bytes and not some other formatting

`AsciicastHeader`/event tuples are serialized with plain `JSON.stringify` —
that is what every writer in this package does (`createAsciicastWriter`,
`encodeAsciicast`): header line, then one `JSON.stringify([time, type, data])`
line per event, `\n`-joined, trailing `\n`. Neither of those two real writers
can serialize an arbitrary already-parsed `AsciicastRecording` end to end,
though: the streaming writer only auto-timestamps from the wall clock (no way
to inject an explicit `time`), and `encodeAsciicast` only accepts a
`Recording`'s `io` track, which has no header `env`/`theme`/marker support at
all. So every fixture here was **authored as a JS header object + event
array, then serialized with that same `JSON.stringify`-per-line convention** —
never hand-typed as raw JSON text — which is what guarantees each file is
already in the codebase's canonical form. `golden-roundtrip.test.ts` re-proves
this on every run (parse the fixture, reserialize with the identical
convention, assert byte-identity) rather than trusting that this README's
methodology was followed correctly.

One consequence worth flagging explicitly: `JSON.stringify` picks the
formatting, not us. A whole-number time is `1`, never `1.0`; a very small time
prints in exponential form (`1e-7`, not `0.0000001`). A hand-typed fixture
using either of those would fail its own byte-identity test on the first run —
which is exactly the "commit the writer's output, not what you typed" rule
this corpus follows.

## Line-ending scope

Every fixture here uses bare `\n`. `\r\n` line-ending handling is already
covered by `../parser.test.ts` ("handles \r\n line endings") — re-proving it
here would only duplicate that test, since this corpus's byte-identity check
would need `\r\n` fixtures to fail on purpose to prove anything new. Not a
gap, a deliberate non-goal.

## What each fixture pins

| File                    | Pins                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-minimal.cast`       | The floor: header carries only the two required dimensions, four plain `o` events.                                                                                                                                                                                                                                                      |
| `02-header-fields.cast` | Every optional header field at once — `timestamp`, `duration`, `title`, `env`, `theme` — plus mixed `o`/`i`. This is the fixture `golden-roundtrip.test.ts` reads back explicitly to measure which of these survive `decodeAsciicast`/`encodeAsciicast` (see below — the short answer is none of them survive decode itself).           |
| `03-markers.cast`       | `m` marker events interleaved with `o` output — pins that markers are dropped by `decodeAsciicast` (documented in `recording-codec.ts`) without disturbing the surrounding events' order or timing.                                                                                                                                     |
| `04-unicode-ansi.cast`  | Real UTF-8 bytes for emoji (`😀🚀🎉`, a surrogate-pair codepoint) and wide CJK text (`文字化け テスト`), plus `\x1b[...m` ANSI SGR sequences (which `JSON.stringify` escapes as `\u001b`, same as the writer would), plus both bare `\n` and `\r\n` line endings _inside event data_ (distinct from the file's own line endings above). |
| `05-timing-edges.cast`  | Zero-time events, two pairs of identical-time events (`0,0` and `3.5,3.5` and `48.5,48.5`), a ~45s idle gap, a sub-microsecond delta (`0.000001`), and one adversarial rounding-boundary value (`2.9999995`, exactly 0.5µs off the nearest microsecond) — see Timing tolerance below.                                                   |
| `06-json-escapes.cast`  | `\n`, `\t`, `"`, and `\` inside event payloads, standalone and mixed in one string.                                                                                                                                                                                                                                                     |
| `07-generated-100.cast` | 120 events (mixed `o`/`i`/`m`), generated **deterministically** (no RNG — every value is a pure function of the event index) by `generate-fixture-07.ts`. Regenerate with `bun run tests/asciicast/fixtures/generate-fixture-07.ts`, then `git diff --stat` the fixture to confirm nothing moved.                                       |
| `08-header-only.cast`   | Zero events at all. Distinct from `01-minimal.cast`: this is the case where `decodeAsciicast` cannot produce a `Recording` — see below.                                                                                                                                                                                                 |

## Measured fossils — what does NOT survive the `.cast` ⇄ `Recording` round trip

These are read directly off the real code (`src/recording/asciicast/recording-codec.ts`),
not inferred from its doc comment, and `golden-roundtrip.test.ts` asserts each one:

- **`m` markers are dropped** by `decodeAsciicast` — documented, and pinned by `03-markers.cast`.
- **`timestamp`, `title`, `env`, `theme` are ALL dropped at the _decode_ step**, not
  merely unrestored at encode: the decoded `Recording` has no fields for any of
  them (`Object.keys()` on a decoded rich `Recording` is exactly
  `["version", "cols", "rows", "durationMicros", "io", "provenance"]`).
  - `title` and `timestamp` **can** be manually restored, but only if the
    caller kept the original values aside and re-supplies them via
    `EncodeAsciicastOptions` at encode time — the Recording itself does not
    carry them forward.
  - `env` and `theme` **cannot** be restored at all, by anyone, through this
    codec: `EncodeAsciicastOptions` has no field for either, so there is no
    call shape that would even attempt it. This is a fossil A3's header-field
    convergence needs to close, not just an untested path.
- **`encodeAsciicast` always emits a `duration` field**, even when the source
  `.cast` never had one — it's computed from `recording.durationMicros`
  unconditionally. A round-tripped header can gain a field the original
  never carried.
- **A `.cast` with zero surviving (non-`m`) events cannot decode at all.**
  `createRecording` refuses an empty `io` track ("A Recording must carry at
  least one non-empty track"), so `decodeAsciicast(parseAsciicast(headerOnly))`
  _throws_ rather than producing an empty `Recording`. Pinned by
  `08-header-only.cast`. The same throw fires for a `.cast` containing only
  `m` events, since markers never reach the `io` track either — there just
  isn't a fixture dedicated to that sub-case, since the failure mode and its
  cause are identical to the zero-event one.

None of the above are bugs to fix in this phase — this suite's job is to
freeze them as measured, named facts so phase A3's Recording-model
convergence has an explicit before-picture to diff against, per
`docs/lessons/refactoring.md`'s read-old-write-new discipline.

## Timing tolerance — measured, not guessed

asciicast time is a float in seconds; the `Recording` clock is integer
microseconds (`secondsToMicros` = `Math.round(seconds * 1_000_000)`). Rounding
to the nearest integer bounds the error at 0.5µs = `5e-7`s. Measured
end-to-end through the real `parseAsciicast → decodeAsciicast → encodeAsciicast
→ parseAsciicast` pipeline (not just the isolated rounding function) on an
adversarial input sitting exactly on that boundary (`2.9999995`, chosen because
`2.9999995 * 1_000_000 = 2999999.5` exactly):

```
orig=2.9999995  back=3  diff=5.00000000069889e-7
```

The tiny excess over the theoretical `5e-7` is float64 representation noise on
`2.9999995` itself (it isn't exactly representable), not an extra source of
rounding error. `golden-roundtrip.test.ts` asserts every surviving event's
`time` round-trips within `1e-6` seconds (1µs) — a round number comfortably
above the measured `~5.0000000007e-7` bound, not a tight fit to it.

## The one thing this corpus deliberately does NOT cover

`"r"` (resize) events. Phase A3 adds them; minting a golden fixture that
encodes today's (non-)support would immediately go stale. Today's measured
behaviour — `parseAsciicast` passes an `"r"` tuple through unvalidated, and
`decodeAsciicast` silently miscategorizes it as directional **input** (the
`type === "o" ? "out" : "in"` ternary has no third branch) — is pinned as a
single explicit "expected fossil" test in `golden-roundtrip.test.ts` instead,
titled to say plainly that it documents today's behaviour and that A3 will
change it. No fixture file backs it; the content lives inline in the test.
