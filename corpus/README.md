# Conformance corpus

Engine-agnostic terminal conformance cases mined from upstream emulator test suites, consumed by termless's differential runner (run the same case against every backend, diff the resulting states). One directory per upstream suite. This file is the cross-suite contract — read it before adding a suite or a converter, because drift between suites is the failure mode this document exists to prevent.

## Suite directory contract

Every `<suite>/` directory provides exactly this shape:

```
<suite>/README.md      # provenance: upstream URL, exact license + how it was verified,
                       # pinned upstream commit, fetch date, attribution notice
<suite>/fetch.ts       # standalone bun script; fetches upstream sources at a PINNED ref
                       # (an unpinned fetch makes "reproducible" a lie the day upstream moves)
<suite>/extract.ts     # standalone bun script; deterministic — re-running fetch+extract with
                       # no arguments must reproduce the checked-in tree byte-identically
<suite>/raw/           # OPTIONAL, license-gated (see below): upstream test text, minimally
                       # structured — one <Stem>.jsonl per upstream source file
<suite>/cases/         # executable cases (the schema below)
<suite>/COVERAGE.md    # generated: extraction-pipeline health (blocks found / converted /
                       # rejection reasons). This is NOT engine conformance results — pass
                       # rates per engine live in the conformance dashboard, never here.
```

Scripts are standalone (`node:*` imports only, no termless imports) so a suite regenerates from a bare clone of this package.

## Licensing rules (load-bearing — do not improvise)

- `raw/` mirrors upstream test text, so it exists ONLY for suites whose license permits redistribution in this MIT repo: MIT, Apache-2.0, BSD, HPND-with-notice. The suite README carries the upstream copyright/permission notice.
- GPL / LGPL suites (kitty, esctest, VTE) and unlicensed suites (wraptest): NEVER vendor source, and NEVER translate test bodies line-by-line into cases — a translation is a derivative work. The only legal paths are (a) running the upstream terminal/binary side-by-side as an oracle backend, and (b) clean-room re-authoring: read the upstream tests as a coverage checklist, then write our own cases from the spec-level behavior. Clean-room cases carry `"license": "termless"` plus a `coverageOf` provenance note naming the upstream scenario they were inspired by.
- Every record — raw and case — carries a `license` field and enough provenance (`sourceLine`, upstream commit in the suite README) to trace it back.

## Case schema (v1)

Cases are versionless-until-broken: the current vocabulary is v1, the runner validates strictly, and an UNKNOWN field is a loud error, not a silent ignore — new expectation kinds land here first, then in converters.

Required: `suite` (string, `"<suite>/<source-file>"`), `name` (string), `cols`/`rows` (numbers), exactly one input flavor, at least one expectation. Provenance: `sourceLine` (number) and `license` (string) — always.

Input flavors (exactly one per case; there is deliberately no third):

- `input` (string) — inline decoded bytes (real ESC etc.), for synthetic sequence cases.
- `htsRef` (string) — relative path to a recorded byte stream (`.hts`), for recorded-session cases. Recording-based imports (e.g. alacritty's ref-tests) land as `htsRef` cases with expectations — they do NOT get their own fixture format.

Expectation vocabulary (any combination):

- `expectedScreen` (string) — viewport text, rows joined with `\n`.
- `expectedCursor` (`{ row, col }`) — 0-based.
- `expectedCells` (array of `{ row, col, text?, fg?, bg?, attrs? }`) — sparse styled-cell asserts; `attrs` is a subset of `bold|italic|underline|inverse|dim|strikethrough`.
- `expectedModes` (object, mode name → boolean) — e.g. `{ "DECAWM": true }`.
- `expectedTitle` (string).
- `steps` (array of `{ input?, resize?, ...expectations }`) — multi-phase cases (feed, assert, feed, assert); when present, top-level input/expectations are disallowed.

A step carries at least one ACTION and any number of expectations:

- `input` (string) — bytes to feed at this phase.
- `resize` (`{ cols, rows }`, positive integers) — resize the terminal at this phase.

**Order within one step is `input` first, then `resize`** — "write these bytes,
now make the terminal narrower, now look at the reflow". It is fixed so a
converter never has to guess, and so a pending input merged into a later step
cannot silently end up applied after that step's resize.

Expectations are OPTIONAL per step, because a resize is frequently setup whose
effect a later step asserts; the case as a whole must still assert something,
and a step that neither feeds nor resizes is rejected. `expectedScreen` after a
resize reads the CURRENT viewport height, not the case's initial `rows`.

Resize is what makes reflow and rewrap testable at all — the behavior where a
terminal's hardest bugs live, and where our own soft-wrap codec invariant has
already failed in production.

Converters that need a new expectation kind extend THIS section first (with a runner-side validator) — per-suite ad-hoc fields are the drift this contract forbids.

Mode names in `expectedModes` are engine-agnostic DEC/xterm vocabulary (`DECAWM`, `DECTCEM`, `ALTSCREEN`, `BRACKETED_PASTE`, `DECCKM`, `DECNKM`); `runner.ts`'s `MODE_MAP` owns the one mapping to backend mode names, and an unmapped name is a load-time error — extend the map and this list together.

## Runner + gap ledger

`runner.ts` executes cases against any `TerminalBackend` (strict load-time validation, every expectation kind, `steps` phases) and returns structured `CaseMismatch` records — state-level evidence consumable by Hab restore tests and the terminfo.dev matrix, not just a pass/fail bit. `tests/corpus-conformance.test.ts` (in the package's `tests/`) drives every case against the pure backends (vterm, xterm, ghostty, vt100).

Engine gaps are DATA, not red tests: `known-gaps.json` maps `<backend>::<suite>::<case name>` to a reason. The ledger ratchets both ways — an un-ledgered mismatch fails (regression or new case), and a ledgered case that starts passing also fails until the entry is removed. A ledger entry is a queue item: it either graduates to an implementation bead (engine gap) or documents a deliberate non-target (era-scoped engines like vt100).

The ledger names its engine. vterm.js is the one backend engine that resolves differently per world — the published package in a fresh clone or CI, a workspace `file:` override inside the hh superproject — so the header row `_engine` records the `vterm.js@<version>` the `vterm::` rows were graded against, the suite fails when a different version resolves (re-grade, then update the header), and every vterm failure text names the package's real path on disk. A green run in one world can no longer pass for a fact about the other.

`expectedScreen` comparison uses ghostty `plainString()` semantics (viewport text, trailing whitespace/rows trimmed) because the first corpus's expectations were mined against it; a future suite whose dumps differ extends the runner with an explicit comparison mode rather than loosening this one. Colors compare by the painted RGB: `Color.index` is identity metadata an engine may preserve or omit (vterm reports the palette slot, xterm.js does not), so it is never part of a conformance verdict — `tests/io/conformance.test.ts`, the io-shaped seed of this grade, encodes the same rule.

## Growth triggers (decided now so nobody re-litigates later)

- Split a suite's converters out of `extract.ts` into `converters/` when the third converter lands.
- Split `corpus/` into its own package/repo when it exceeds ~20MB or a second non-termless consumer materializes; until then, co-location with the runner wins.

## Suites

| Suite       | Upstream                       | License | raw/? | Strategy           |
| ----------- | ------------------------------ | ------- | ----- | ------------------ |
| `ghostty/`  | github.com/ghostty-org/ghostty | MIT     | yes   | vendor-and-convert |
| `libvterm/` | github.com/neovim/libvterm     | MIT     | yes   | vendor-and-convert |

Evaluated and REJECTED on licence, so nobody re-opens the question: **esctest /
esctest2** (GPL-2.0, verified in `ThomasDickey/esctest2/LICENSE`) — vendoring
and line-by-line translation are both barred by the rules above; only an
external-oracle backend or clean-room re-authoring would be legal. **vttest**
is MIT but interactive and human-judged, with no machine-readable
expectations — its scenarios reach us anyway through libvterm's MIT
`t/90vttest_*.test` files. Also legal but lower value: **alacritty's `vte`**
(MIT/Apache-2.0, one expectation-free demo stream) and **wezterm** (MIT,
executable-only Rust tests that would have to be ported by hand).
