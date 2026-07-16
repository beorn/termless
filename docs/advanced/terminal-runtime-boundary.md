# The Terminal Runtime Boundary

Termless sits between two kinds of software that are easy to conflate: terminal **engines** (emulators that turn a byte stream into screen state) and terminal **runtimes** (applications that persist, resume, and multiplex live sessions). This page pins down which responsibilities live where, so a consumer never has to guess which layer owns a behavior — or worse, reimplement one layer inside another.

## The three layers

```
runtime      persist / resume / multiplex live sessions   (e.g. a session host)
harness      compare, replay, assert                       (termless)
engine       bytes → screen state                          (vterm.js, xterm, ghostty-web, vt100.js)
```

Dependencies point down only. Engines know nothing about the harness; the harness consumes engines through [backends](/concepts/backend). Runtimes consume engines directly as their state authority; they may use Termless in tests and tooling, never as a production runtime dependency.

## What the engine owns (vterm.js and peers)

An engine is the **source of truth for terminal state**, byte-for-byte:

- the grid, scrollback, alternate screen, and per-cell attributes,
- the cursor — including the deferred-autowrap position after a full-width write, which survives both a same-geometry resize and a snapshot/restore roundtrip,
- resize **reflow**: soft-wrapped logical lines repack at the new width and the cursor follows its logical line,
- modes, title, and OSC state,
- a **snapshot/restore contract**: `snapshot()` captures everything above as plain data; `restore()` rebuilds an equivalent terminal, so a checkpointed session resumes exactly where it stopped,
- **identity-preserving serialization**: palette-indexed color re-emits as palette SGR, truecolor as truecolor — state is never round-tripped through a lossy re-encoding.

vterm.js is the reference engine this project treats as its restore-fidelity oracle; the differential suites hold it to that bar against xterm and ghostty rather than trusting it.

## What the harness owns (termless)

Termless never emulates. It **hosts engines and makes claims about them checkable**:

- the shared `Terminal` contract and per-engine backends, so every assertion works across engines,
- [state digests](/api/state-digest) — one vocabulary for "are these two terminals in the same state?",
- differential suites: engine vs engine on the same input, live vs replay vs rehydrate on the same recording,
- corpora: the [conformance corpus](/advanced/conformance-corpus) (upstream-derived cases plus recorded-session differentials) and [journal](/reference/formats/journal) / asciicast replay,
- matchers and renderers for test output.

When the harness finds an engine divergence, the divergence is **data** (a ledger entry or a catalog line), not a patch inside the harness: engine fixes belong upstream in the engine.

## What a runtime owns (and must not reimplement)

A session runtime — anything that detaches, persists, and reattaches live terminals — should consume the engine as its state authority:

- fold PTY output into an engine instance in arrival order (output and resizes share one ordered stream),
- checkpoint by `snapshot()`, resume by `restore()` — never by replaying re-encoded screen text,
- read projections (plain text, styled ANSI) **from** engine state; never treat a projection as the state.

The recurring failure mode this boundary prevents: a runtime keeps its own half-emulator (a text buffer plus ad-hoc ANSI handling), which drifts from real terminal semantics exactly at the hard cases — deferred wrap, reflow, palette identity — and every one of those drifts becomes a user-visible resume artifact.

## Where conformance targets come from

[terminfo.dev](https://terminfo.dev) defines the feature matrix engines aim at; upstream emulator test suites (see the corpus page for licensing rules) supply executable expectations; recorded real sessions supply the shapes synthetic cases miss. The harness runs all three against every backend.
