# libvterm suite

Terminal conformance cases mined from **libvterm**'s `t/*.test` corpus — the
reference C implementation's own test suite, and the closest thing the VT
lineage has to an executable specification.

## Provenance

|               |                                                         |
| ------------- | ------------------------------------------------------- |
| Upstream      | <https://github.com/neovim/libvterm>                    |
| Pinned commit | `934bc2fbf21800ac3458a499df8820ca5fb45fd3` (2025-11-21) |
| Fetched       | 2026-09-01                                              |
| Source path   | `t/*.test` (43 files)                                   |
| License       | **MIT**                                                 |
| Strategy      | vendor-and-convert (`raw/` permitted — see below)       |

Upstream was **archived on 2026-06-19**; libvterm now lives inside the neovim
tree. The corpus is therefore stable rather than moving, which is the good case
for a pinned mirror — but a refresh must re-point `fetch.ts` at neovim's own
repo, not just bump the ref here.

### License verification

Verified by reading `LICENSE` at the pinned commit. It is the MIT License
verbatim, opening `The MIT License / Copyright (c) 2008 Paul Evans
<leonerd@leonerd.org.uk>`. MIT permits redistribution in this MIT repo, so
`raw/` mirrors the upstream test text under the corpus contract's licensing
rules, and every raw record and case carries `"license": "MIT"`.

### Attribution

> The MIT License
>
> Copyright (c) 2008 Paul Evans <leonerd@leonerd.org.uk>
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
> THE SOFTWARE.

## Regenerating

```console
$ bun fetch.ts            # -> ./src (gitignored scratch), at the pinned ref
$ bun extract.ts ./src    # -> cases/, raw/, COVERAGE.md
```

Deterministic: re-running both with no arguments reproduces the checked-in tree
byte-identically.

## The one thing to know before editing the converter

**A `!Name` block is not an independent test.** libvterm's harness runs one
continuous session per file and resets only on an explicit `RESET`, so a block
inherits the terminal state every block above it left behind — `!Cursor Down`
opens with `PUSH "\e[C"` and asserts `?cursor = 5,1`, where both the row and
the column come from earlier blocks.

The corpus runner gives every case a FRESH backend, so `extract.ts` carries the
whole input stream since the last `RESET` as each case's prefix.

This is worth stating loudly because getting it wrong is quiet: converting
blocks standalone yielded a plausible-looking 65/111 against vterm, and the
tell that it was the CONVERTER rather than the engine was that xterm.js scored
the same. A corpus can be confidently wrong, and a cross-engine spread that
looks like consensus is the signal to distrust the harness first.

**The same class has now bitten three times**, which is why it gets its own
section:

1. Blocks converted standalone, losing the session prefix (above).
2. Byte escapes decoded character-by-character, so `\xC3\x81` re-encoded to
   four bytes and `Á` reached the engine as `Ã` — see `unescape()`.
3. The file PREAMBLE dropped. The vttest files paint an entire screen with
   dozens of directives before their single `!Output` block; discarding those
   left eight cases asserting a finished picture while feeding nothing — see
   `seedPreamble()`.

Every one of the three presented as an engine failure, and every fix raised
ALL FOUR engines together. That is the discriminator: **a change that moves
every engine is a harness change; a change that moves one is an engine
change.** Check that before filing anything here as an engine gap.

## RULINGS: two deliberate divergences — do NOT open these as vterm bugs

Both were ruled by the operator on 2026-09-01, and both come down to the same
principle: **"three engines agree" is a fact about their shared ancestry, not
an argument about correctness.** Where our consumers read vterm on both ends,
matching a reference implementation's internal choice would be churn.

| behavior                                                   | libvterm's family                                                     | vterm's family                                                | ruling                                                     |
| ---------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------- |
| cursor after a glyph fills the last column (deferred wrap) | on the last column + a pending-wrap flag — libvterm, ghostty          | `col == cols`, one past the end — **vterm**, xterm.js, vt100  | vterm keeps its convention; the CORPUS is normalized to it |
| cursor when a resize shrinks below it                      | clamped to the last column of the old row — libvterm, xterm.js, vt100 | followed through reflow onto the continuation row — **vterm** | vterm keeps its behavior; the case stays ledgered          |

### Resize shrink: following the cursor is the modern behavior

`16state_resize :: Resize shrink moves cursor` is a genuine BEHAVIORAL
divergence rather than a representational one, and vterm's side is the
defensible one: following the cursor through reflow is what a reflowing
terminal does, while clamping is the pre-reflow legacy the other three
inherit. Our consumers read vterm at both ends — record and replay — so there
is no internal drift to correct. Revisit **only** if the herdr oracle later
shows this exact case producing real production drift.

### Deferred wrap: normalized converter-side, not "fixed"

When a glyph lands on the final column with autowrap on, the terminal owes a
wrap it has not performed yet, and the two families represent that moment
differently (see the table above).

Neither is wrong. **vterm keeps its convention.**
Our snapshot codec, hab attach, and every downstream consumer read that
representation today, and changing a load-bearing convention to match a
reference implementation's internal choice is churn, not a fix.

So the corpus adapts to us: `extract.ts`'s `normalizeDeferredWrapCursor`
translates the expectation, and only where the DSL _proves_ the phantom — a
`putglyph` trace ending on the last column of the same row, with DECAWM on.

The guard is the interesting part. `!DEC Auto Wrap Mode` also ends a glyph on
the last column, but with autowrap OFF there is no pending wrap: the cursor
genuinely belongs on the last column, and our engines reporting `cols` there is
a **real divergence**. Normalizing it would have masked a live bug behind a
representation difference, so that case stays red and ledgered. Likewise
`11state_movecursor` emits no `putglyph` traces, so nothing there is
normalized — silence beats a confident guess.

## What converts, and what does not

`COVERAGE.md` is generated and carries the current numbers. In summary, cases
convert when their assertions are `?cursor`, `?screen_row`, `?screen_chars` or
`?screen_cell`; they are rejected when the block resizes mid-flight, drives
mouse/key/paste input whose assertions are bytes sent back upstream, or asserts
only libvterm's internal callback traces.

`COVERAGE.md` § Schema gaps names what a schema-v1 extension would unlock —
most importantly a resize verb, which is what currently blocks every
reflow-on-resize case.
