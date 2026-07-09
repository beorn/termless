# ghostty corpus

A machine-readable extraction of [ghostty](https://github.com/ghostty-org/ghostty)'s
inline Zig unit tests for its terminal core (`src/terminal/*.zig`), so a JS
terminal emulator (e.g. `@termless/vterm`) can run the same conformance cases
without a Zig toolchain.

## Provenance

- **Upstream**: <https://github.com/ghostty-org/ghostty>
- **License**: MIT (verified via GitHub API `license.spdx_id` at fetch time)
- **Path**: `src/terminal/*.zig` (see `source-files.ts` for the exact file list and why each one is or isn't included)
- **Fetched**: 2026-07-08, from `main` at commit `b14d9238366f87e1792a4363d60523ced10e310f`
- Every record below carries `"license": "MIT"` and traces back to a specific upstream file + line via `sourceLine`. This corpus reproduces upstream test bodies (`zigBody` in `raw/`) and literal string content (`input`/`expectedScreen` in `cases/`) under that same MIT license; it is not a copy of ghostty itself.

## What's here

```
extract.ts        # standalone bun script: raw extraction + mechanical conversion
fetch.ts          # standalone bun script: fetches source-files.ts's list from upstream
source-files.ts    # single source of truth for which src/terminal/*.zig files are in scope
raw/<Stem>/*.json  # every test block, unconverted (1287 files)
cases/<Stem>/*.json # the mechanically-convertible subset, as executable cases (14 files)
COVERAGE.md         # per-file totals, conversion-rejection reasons, category breakdown
```

`<Stem>` is the source filename with `.zig` stripped (e.g. `Terminal`, `Screen`, `stream_terminal`).

## Re-running / regenerating

```bash
bun fetch.ts [outDir]              # default outDir: ./src (not checked in)
bun extract.ts <outDir> [corpusOutDir]  # default corpusOutDir: this directory
```

`fetch.ts` pulls the exact file list in `source-files.ts` from upstream `main`
into `outDir`. `extract.ts` then reads `.zig` files from that directory (only
the files named in `source-files.ts` — anything else present is ignored) and
(re)writes `raw/`, `cases/`, and `COVERAGE.md`. Both scripts are standalone
(`node:fs`/`node:path`/`node:url` only — no imports from the rest of this
repo), so they work the same whether run from a monorepo checkout or a
standalone clone of this package.

Upstream `main` moves — re-running today will not byte-for-byte match what's
checked in here (ghostty adds/edits tests continuously). That's expected;
treat a re-run as a refresh, not a correctness check on the existing corpus.

## `raw/` schema

One record per top-level `test "NAME" { ... }` block, extracted with a
brace-balanced, string/comment-aware scanner (handles Zig's `//` line
comments and `\\`-prefixed multiline string literals) — not a naive regex, so
nested braces inside the test body can't truncate extraction early. Every
file's extraction is cross-checked against a literal `grep -c '^test "'`
count and the script throws (not warns) on any mismatch, so a declaration
shape the scanner doesn't recognize fails loud instead of silently
under-extracting.

```ts
{
  suite: string;      // always "ghostty"
  file: string;        // source filename, e.g. "Terminal.zig"
  testName: string;     // the test's declared name, Zig escapes decoded
  sourceLine: number;    // 1-based line number of `test "..."` in the source file
  zigBody: string;        // the complete original Zig source text of the block, VERBATIM (escapes NOT decoded)
}
```

## `cases/` schema

The subset of `raw/` blocks that are fully mechanical — see `COVERAGE.md` for
exactly which shape qualifies and why the rest don't. Every string field has
Zig escape sequences (`\n \r \t \\ \' \" \xNN \u{...}`) decoded to real
characters — this is the part that matters for correctness, since a JS
emulator needs actual bytes (e.g. a real `0x1B` ESC byte for `\x1B[1;1H`), not
the four-character literal `\`, `x`, `1`, `B`.

```ts
{
  suite: string;        // "ghostty/<file>", e.g. "ghostty/Terminal.zig" or "ghostty/stream_terminal.zig"
  name: string;          // decoded test name
  cols: number;
  rows: number;
  input: string;          // decoded bytes to feed the emulator, in source order
  expectedScreen: string;  // decoded expected plainString() screen dump
  sourceLine: number;
  license: "MIT";
}
```

`raw/<Stem>/0007-foo.json` and `cases/<Stem>/0007-foo.json` (when the latter
exists) describe the *same* test — same zero-padded source-order index, same
slugified name — so a converted case can always be traced back to its full
original Zig source via the matching `raw/` record.

Two converters currently populate `cases/`:

- **`Terminal.zig`** — `Terminal.init(alloc, .{ .cols = N, .rows = M })`, input fed only via `print`/`printString` (literal strings/chars only — no variables, no computed codepoints), asserted via `expectEqualStrings(literal, capturedPlainString)`.
- **`stream_terminal.zig`** — same `Terminal.init` shape, wrapped in a `Stream` (`.initAlloc(alloc, .init(&t))`), input fed only via `s.nextSlice("literal bytes")` — including real escape sequences like `\x1B[1;1H` — asserted the same way. This is the better conformance-corpus shape: the Zig string literal *is* the wire format, so there's no method-name-to-VT-sequence translation to get wrong.

Both converters whitelist which `t.`/`s.` method calls are allowed inside a
convertible test (reads like `isDirty()`/`clearDirty()` are fine; anything
that mutates terminal state outside the whitelisted input path disqualifies
the test) and reject direct field assignment, multiple terminal/stream
instances, `@embedFile`, and non-literal arguments. See `COVERAGE.md` for the
full breakdown of why each non-converted test was rejected.

## Coverage

1287 raw test blocks across 28 files, 14 auto-converted. Full per-file
breakdown, rejection reasons, and a heuristic category breakdown of the
non-converted remainder (the signal for what to convert next) are in
[COVERAGE.md](./COVERAGE.md).

## Extending this corpus

To add a converter for another file/shape:

1. Add a `tryConvertXTest(raw: RawTestBlock): ConvertResult` function in `extract.ts` following the existing two as a template (reuse `parseColsRows` and `findExpectedScreen` — don't duplicate the bind/assert-pairing logic).
2. Register it in the `CONVERTERS` map keyed by filename.
3. Re-run `bun extract.ts <src> .` and check `COVERAGE.md`'s totals moved.

To add another upstream file to raw extraction (no converter required): add
its filename to `source-files.ts`'s `SOURCE_FILES` array — `fetch.ts` and
`extract.ts` both pick it up automatically. Re-run the file census described
in `source-files.ts`'s comment periodically; ghostty's `src/terminal/`
directory grows over time.
