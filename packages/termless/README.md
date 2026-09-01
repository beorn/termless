# termless

Headless terminals: test, record, replay, and run sessions.

`termless` is the umbrella package for the [termless](https://termless.dev/)
stack — an effect-style umbrella with arity-scoped subpaths, not a single flat
namespace. Backend arity is visible in the import path: `.`, `./fmt`,
`./rec`, and `./contract` have no engine. `./backends` is the only home of
plurality.

**If you never import `termless/backends`, you never have more than one
engine.**

The engine itself is [vterm.js](https://github.com/beorn/vterm) — a
pure-TypeScript, zero-dependency terminal emulator targeting full
VT/ECMA-48/xterm coverage, graded at arm's length by its own conformance rig.

## Subpaths

| Subpath             | Contains                                                                                                                            | Engine? |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | :-----: |
| `termless`          | `createTerminal` + the common path: screenshots, key mapping, diffing                                                               |   no    |
| `termless/contract` | The `Terminal` read contract, `TerminalBackend`, region view types                                                                  |   no    |
| `termless/fmt`      | The `.tty` / `.ttyz` recording format — types + read/write surface                                                                  |   no    |
| `termless/rec`      | `Recording`, its codecs, journal-replay, and replay/view                                                                            |   no    |
| `termless/backends` | The backend registry — `backend()`, `backends()`, `isReady`, `buildBackend()`                                                       | **yes** |
| `termless/test`     | _Reserved._ Vitest matchers, fixtures, and snapshot assertions. Ships from `@termless/test` today.                                  |   no    |
| `termless/session`  | _Reserved._ The sealed live-session API (`session.readable`/`writable`/`recording`). Unbuilt — see `docs/reference/formats/tty.md`. |   no    |

## Quick start

```typescript
import { createTerminal } from "termless"
import { backend } from "termless/backends"

const term = createTerminal({ backend: await backend("vterm"), cols: 80, rows: 24 })
term.feed("hello")
term.screen.getText() // "hello"
await term.close()
```

Working directly against a specific engine's own package (`@termless/vterm`,
`@termless/xtermjs`, …) skips `termless/backends` entirely — that is the
single-engine path, and it never imports plurality:

```typescript
import { createTerminal } from "termless"
import { createVtermBackend } from "@termless/vterm"

const term = createTerminal({ backend: createVtermBackend(), cols: 80, rows: 24 })
```

## Why an umbrella

Scoped `@termless/*` packages (`@termless/core`, `@termless/vterm`,
`@termless/xtermjs`, …) remain the satellite packages — native/WASM backends
stay scoped so their install weight (Rust builds, WASM blobs) is opt-in, not
bundled into every install. `termless` is the single-semver front door: one
version, one changelog, the subpaths above as its whole public surface.
Native backends are the deliberate exception to "single semver" — their
install cost is why they stay out.

## Learn more

- [termless.dev](https://termless.dev/) — full documentation, guides, and the
  cross-terminal conformance corpus.
- [vterm.js](https://github.com/beorn/vterm) — the engine: coverage,
  differential tests against the classic VT corpus, and the
  deliberate-divergence ledger.
