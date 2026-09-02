# asciicast golden corpus

Committed `.cast` files that pin asciicast v2 parse/write/decode/encode
behaviour byte-for-byte. Minted before phase A3 (unterm) converged the
`Recording` model, to freeze the **pre-A3** behaviour of `parseAsciicast` and
the (now deprecated) `decodeAsciicast`/`encodeAsciicast` pair as a committed
oracle — per `docs/lessons/refactoring.md`'s read-old-write-new discipline —
this corpus is still exactly that oracle for those two functions, unchanged.

Slice 4 added `"r"` (resize) to the `o`/`i`/`m` vocabulary, via a NEW
io-shaped pair, `readAsciicast`/`writeAsciicast`
(`../../src/recording/asciicast/io-codec.ts`), which every fixture here is
now ALSO measured against (see "io-pair round trip" below and
`../io-codec.test.ts`) — the deprecated pair's pre-A3 fossils stay pinned as
before, alongside proof that the new pair doesn't share them. Read alongside
`../golden-roundtrip.test.ts`, which discovers every `*.cast` file here via
`readdir` — dropping a new fixture in this directory gets it covered
automatically, no test-file edit required.

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

| File                    | Pins                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-minimal.cast`       | The floor: header carries only the two required dimensions, four plain `o` events.                                                                                                                                                                                                                                                                         |
| `02-header-fields.cast` | Every optional header field at once — `timestamp`, `duration`, `title`, `env`, `theme` — plus mixed `o`/`i`. This is the fixture `golden-roundtrip.test.ts` reads back explicitly to measure which of these survive `decodeAsciicast`/`encodeAsciicast` (see below — the short answer is none of them survive decode itself).                              |
| `03-markers.cast`       | `m` marker events interleaved with `o` output — pins that markers are dropped by `decodeAsciicast` (documented in `recording-codec.ts`) without disturbing the surrounding events' order or timing.                                                                                                                                                        |
| `04-unicode-ansi.cast`  | Real UTF-8 bytes for emoji (`😀🚀🎉`, a surrogate-pair codepoint) and wide CJK text (`文字化け テスト`), plus `\x1b[...m` ANSI SGR sequences (which `JSON.stringify` escapes as `\u001b`, same as the writer would), plus both bare `\n` and `\r\n` line endings _inside event data_ (distinct from the file's own line endings above).                    |
| `05-timing-edges.cast`  | Zero-time events, two pairs of identical-time events (`0,0` and `3.5,3.5` and `48.5,48.5`), a ~45s idle gap, a sub-microsecond delta (`0.000001`), and one adversarial rounding-boundary value (`2.9999995`, exactly 0.5µs off the nearest microsecond) — see Timing tolerance below.                                                                      |
| `06-json-escapes.cast`  | `\n`, `\t`, `"`, and `\` inside event payloads, standalone and mixed in one string.                                                                                                                                                                                                                                                                        |
| `07-generated-100.cast` | 120 events (mixed `o`/`i`/`m`), generated **deterministically** (no RNG — every value is a pure function of the event index) by `generate-fixture-07.ts`. Regenerate with `bun run tests/asciicast/fixtures/generate-fixture-07.ts`, then `git diff --stat` the fixture to confirm nothing moved.                                                          |
| `08-header-only.cast`   | Zero events at all. Distinct from `01-minimal.cast`: this is the case where `decodeAsciicast` cannot produce a `Recording` — see below.                                                                                                                                                                                                                    |
| `09-resize.cast`        | `r` (resize) events between `o`/`i` output/input — added slice 4. Pins that `readAsciicast` turns each into a `control`/`resize` `Event` (`../io-codec.test.ts` covers the mapping in isolation) and that the deprecated `decodeAsciicast` drops both resizes here alongside no markers (there are none in this fixture) — see "io-pair round trip" below. |

## Measured fossils — what does NOT survive the DEPRECATED `.cast` ⇄ `Recording` (Trace) round trip

`decodeAsciicast`/`encodeAsciicast` (`src/recording/asciicast/recording-codec.ts`)
are `@deprecated` as of slice 4 — thin wrappers composing the io-shaped pair
below with the `Trace` bridges (`../../src/recording/trace-bridges.ts`). These
fossils are about THAT composition, read directly off the real code, not
inferred from its doc comment; `golden-roundtrip.test.ts` asserts each one:

- **`m` markers are dropped** by `decodeAsciicast` — documented, and pinned by `03-markers.cast`.
- **`r` resize events are ALSO dropped**, as of slice 4 — pinned by
  `09-resize.cast` and the flipped "expected fossil" test. Pre-slice-4 this
  was a worse fossil: an `"r"` event was silently MISCATEGORIZED as
  directional input rather than dropped. Both `m` and `r` are dropped for the
  same underlying reason: `traceFromRecording` has no `io`-track row shape
  for `mark` or `control`, only `output`/`input` — see
  `../../src/recording/io-compat.ts`.
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
    call shape that would even attempt it. Closing this fossil is exactly
    what the io-shaped pair below is for — `readAsciicast`/`writeAsciicast`
    carry both.
- **`encodeAsciicast` always emits a `duration` field**, even when the source
  `.cast` never had one — it's computed from `recording.durationMicros`
  unconditionally, because a `Trace`'s `durationMicros` is a mandatory field
  with nowhere to be absent. A round-tripped header can gain a field the
  original never carried. `writeAsciicast` (below) does NOT make this same
  choice — it emits `duration` only when the io `Recording`'s header
  actually has one, so this fossil is specific to the `Trace`-shaped
  composition, not something the new pair inherits. (It still shows up for
  free on this deprecated route, though: `recordingFromTrace`, which
  `encodeAsciicast` composes through, always sets `header.duration` from the
  Trace, so `writeAsciicast` never sees it absent here — see the io-pair
  section.)
- **A `.cast` with zero surviving (non-`m`, and as of slice 4 non-`r`) events
  cannot decode at all.** `traceFromRecording` refuses when nothing survives
  into the `io` track ("no output/input events survived conversion"), so
  `decodeAsciicast(parseAsciicast(headerOnly))` _throws_ rather than
  producing an empty `Recording`. Pinned by `08-header-only.cast`. The same
  throw fires for a `.cast` containing only `m` and/or `r` events, since
  neither reaches the `io` track — there just isn't a fixture dedicated to
  that sub-case, since the failure mode and its cause are identical to the
  zero-event one. (Pre-slice-4 this same throw came from `createRecording`'s
  "A Recording must carry at least one non-empty track" instead — same
  failure, different code path, different message.)

None of the above are bugs to fix — this is the deprecated door's permanent,
documented shape now, not a before-picture awaiting convergence. The io-pair
section further down this file is the after-picture: the same corpus, read
losslessly.

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

## io-pair round trip — `readAsciicast`/`writeAsciicast` are the symmetric `.cast` codec

Slice 4 minted `readAsciicast`/`writeAsciicast`
(`../../src/recording/asciicast/io-codec.ts`): the io-shaped `.cast` codec,
built on the full io `Event` vocabulary (`output`/`input`/`control`/`mark`/`exit`,
`@termless/core/io`) rather than the deprecated `Trace`-shaped `io` track's
bytes-only rows. Its gold property, proved by `golden-roundtrip.test.ts`'s
"io-pair round trip" block over **every** fixture in this directory:
`writeAsciicast(readAsciicast(text))` is **byte-identical to `text`**, with an
all-zero drop tally (`{ mode: 0, signal: 0, exit: 0 }` — this corpus has no
event kind `writeAsciicast` lacks a wire form for). No exceptions, no
per-field asterisks: not on `08-header-only.cast` (the io `Recording` type
has no non-empty-track invariant, so this door round-trips it instead of
throwing like the deprecated one does — see "Measured fossils" above), and
not on `duration` either — `writeAsciicast` emits `duration` ONLY when the io
`Recording`'s header actually carries one, so a fixture that never declared
one (seven of the nine) round-trips to text that still doesn't, rather than
gaining the field the way the deprecated `encodeAsciicast` does (see the
"Measured fossils" bullet above). This is _why_ the byte-identity claim can
be unconditional here where the deprecated corpus's own round-trip assertions
need several carve-outs (markers dropped, resizes dropped, header fields
lost, duration gained, an empty-`io`-track throw).

Per-event-type and per-header-field mapping (including the two thrown-error
shapes for a malformed resize or an unknown code, and the duration
present-vs-absent rule in isolation) is covered by `../io-codec.test.ts`, not
repeated here.

`09-resize.cast` is the only fixture minted for slice 4 specifically — the
other eight predate it and needed no changes; adding `r` events to the
vocabulary is exactly the kind of change a `readdir`-discovered corpus absorbs
for free.
