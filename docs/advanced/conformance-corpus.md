---
title: Conformance Corpus
description: How Termless mines upstream terminal test suites into engine-agnostic conformance cases and runs them differentially against every backend.
---

# Conformance Corpus

The `corpus/` tree holds engine-agnostic terminal conformance cases mined from
upstream emulator test suites. Termless's differential runner executes each case
against every backend and diffs the resulting terminal state — a divergence is a
bug. One directory per upstream suite.

The normative contract is
[`corpus/README.md`](https://github.com/beorn/termless/blob/main/corpus/README.md);
this page is the site-reader summary.

## Per-suite layout

Every `<suite>/` directory provides exactly this shape:

| Path          | Role                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `README.md`   | Provenance: upstream URL, exact license and how it was verified, pinned upstream commit, fetch date, attribution notice. |
| `fetch.ts`    | Standalone Bun script; fetches upstream sources at a **pinned** ref (an unpinned fetch makes "reproducible" a lie the day upstream moves). |
| `extract.ts`  | Standalone Bun script; **deterministic** — re-running fetch + extract with no arguments reproduces the checked-in tree byte-identically. |
| `raw/`        | Optional, license-gated: upstream test text, minimally structured (one `.jsonl` per upstream file). |
| `cases/`      | Executable cases (schema below).                                                                 |
| `COVERAGE.md` | Generated extraction-pipeline health (blocks found / converted / rejection reasons) — **not** engine conformance results. |

Scripts are standalone (`node:*` imports only, no Termless imports) so a suite
regenerates from a bare clone.

## Licensing rules

These are load-bearing — do not improvise:

- `raw/` mirrors upstream test text, so it exists **only** for suites whose
  license permits redistribution in this MIT repo: MIT, Apache-2.0, BSD,
  HPND-with-notice. The suite README carries the upstream copyright notice.
- **GPL / LGPL** suites (kitty, esctest, VTE) and **unlicensed** suites
  (wraptest) are **never** vendored, and their test bodies are **never**
  translated line-by-line into cases — a translation is a derivative work. The
  only legal paths are (a) running the upstream terminal as a side-by-side
  oracle backend, and (b) **clean-room re-authoring**: read the upstream tests
  as a coverage checklist, then write original cases from the spec-level
  behavior. Clean-room cases carry `"license": "termless"` plus a `coverageOf`
  provenance note naming the upstream scenario.

## Case schema (v1)

The runner validates strictly: an unknown field is a loud error, not a silent
ignore. Required on every case: `suite`, `name`, `cols`/`rows`, exactly one
input flavor, at least one expectation, and provenance (`sourceLine`,
`license`).

Input flavors — exactly one per case:

- `input` (string) — inline decoded bytes (real `ESC` etc.), for synthetic
  sequence cases.
- `htsRef` (string) — relative path to a recorded byte stream (`.hts`), for
  recorded-session cases.

Expectation vocabulary (any combination): `expectedScreen`, `expectedCursor`,
`expectedCells`, `expectedModes` (engine-agnostic DEC/xterm mode names),
`expectedTitle`, and `steps` (multi-phase feed-and-assert). A converter that
needs a new expectation kind extends the schema and its runner-side validator
first — per-suite ad-hoc fields are exactly the drift this contract forbids.

## Runner

[`tests/corpus-conformance.test.ts`](https://github.com/beorn/termless/blob/main/tests/corpus-conformance.test.ts)
drives every case against the four pure backends — **vterm**, **xterm**,
**ghostty**, and **vt100** — and returns structured `CaseMismatch` records
(state-level evidence, not just a pass/fail bit) consumable by downstream
restore/conformance tooling and the [terminfo.dev](https://terminfo.dev) matrix.

Engine gaps are **data, not red tests**: `known-gaps.json` maps
`<backend>::<suite>::<case>` to a reason. The ledger ratchets both ways — an
un-ledgered mismatch fails (regression or new case), and a ledgered case that
starts passing also fails until the entry is removed.

## Session differentials at the guest seam

Alongside the per-case corpus runner, two differential tests replay **whole
recorded sessions** through both engines at the viewport/scrollback guest seam
(`vtermGuest` ⇔ `xtermGuest`) and diff the final grids:

- **`cast-session-differential.test.ts`** parses an asciicast
  [`.cast`](../reference/formats/asciicast) recording and feeds its output
  events to both guests in recorded order (input and marker events never reach a
  terminal's write side).
- **`journal-session-differential.test.ts`** replays a
  [journal](../reference/formats/journal) through both guests via the same
  `replayJournal` core, driven through a `JournalReplayTarget` — asserting the
  event-class semantics too (input never feeds the write side; a mid-stream
  resize applies to both; lifecycle surfaces in order).

Bundled hand-authored fixtures pin **zero divergence**. For external sessions,
`TERMLESS_CAST_DIR` and `TERMLESS_JOURNAL_DIR` point at a directory of `.cast` /
`.json` files: every file must replay to completion, and each per-file
divergence is **reported** as a conformance-backlog seed — not failed — until a
curated set graduates to pinned expectations. Sourcing external sessions follows
the same licensing rules as the corpus above.

This surface has already caught a real engine bug: a cursor left at a stale
absolute row through a resize reflow — since fixed upstream in vterm.js.

## See Also

- [Cross-Backend Conformance](./compat-matrix) — the per-feature conformance
  suite.
- [Terminal Emulator Differences](../emulator-differences) — the known
  divergences these tests exist to catch.
- [Journal Replay](../reference/formats/journal) — the journal input shape.
