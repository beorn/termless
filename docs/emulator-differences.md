---
title: Terminal Emulator Differences
description: Known behavioral divergences between terminal emulators discovered through cross-backend testing with Termless.
---

# Terminal Emulator Differences

Termless backends wrap different terminal emulators, each with its own VT parser implementation. This document records the known behavioral divergences discovered through cross-backend testing.

::: tip Full Feature Matrix
For a comprehensive, interactive capability matrix across all backends, visit **[terminfo.dev](https://terminfo.dev)** — powered by termless census probes.
:::

## Backends

Termless supports [10 backends](/guide/backends), each wrapping a different terminal emulator. The divergences below were discovered through cross-backend testing of the three earliest backends:

| Backend             | Emulator        | Implementation         | Reflow | Kitty Keyboard | OSC 8 |
| ------------------- | --------------- | ---------------------- | ------ | -------------- | ----- |
| `@termless/xtermjs` | xterm.js 5.5.0  | `@xterm/headless` (JS) | Yes    | No             | Yes   |
| `@termless/ghostty` | Ghostty 0.4.0   | `ghostty-web` (WASM)   | Yes    | Yes            | Yes   |
| `@termless/vt100`   | Pure TypeScript | Zero native deps       | No     | No             | No    |

xterm.js is the **reference backend** -- it has the widest adoption, passes the most conformance tests, and is what Silvery's test infrastructure (`createTermless()`) uses by default. Divergences from xterm.js are usually bugs in the other backend or in our ANSI output.

**Usually, not always.** Being the reference means being the *fixed point of comparison*, not being right about everything. Where the reference itself is the less faithful of the two, that is recorded rather than smoothed over -- see the **vterm vs xterm.js** section below, where xterm.js is the degrading side in four of six known divergences.

For the full capability matrix across all 10 backends, see the [Backend Capabilities](/guide/backends) page or [terminfo.dev](https://terminfo.dev).

## vterm vs xterm.js

vterm is the production shell guest; xterm.js is the differential reference it is measured against. Those are different jobs, and the reason for the split is not that vterm is a lighter xterm.js -- **on most of the points where the two disagree, vterm is the faithful one and xterm.js is the side that degrades.**

Six divergences are known and asserted. In four of them vterm reports what the terminal actually said and xterm.js flattens it:

| #  | Divergence                              | xterm.js                                  | vterm                                     | Faithful     |
| -- | --------------------------------------- | ----------------------------------------- | ----------------------------------------- | ------------ |
| D1 | ZWJ emoji clustering                    | one wide cell per sub-emoji               | one wide cell for the whole cluster       | neither\*    |
| D2 | OSC 8 hyperlink presentation            | auto-underlines linked cells              | stores the link, does not force underline | neither\*\*  |
| D3 | DECSCUSR cursor shape                   | hardcodes `block`                         | reports the real shape (underline/bar)    | **vterm**    |
| D4 | DECTCEM cursor visibility               | always reports visible                    | reports real hide/show                    | **vterm**    |
| D5 | Fancy underline styles                  | collapses curly/double/dotted to plain    | reports `underlineStyle`                  | **vterm**    |
| D6 | Narrowing reflow at `scrollback: 0`     | truncates the row, drops the overflow     | rewraps downward, content preserved       | **vterm**    |

\* Real terminals disagree on D1 too; single non-ZWJ emoji agree across both.
\*\* The Silvery `Cell` vocabulary has no hyperlink slot, so on D2 **the link itself is dropped by both backends.** Only the underline decoration differs. This one bites anything that renders links -- see below.

**So the answer to "why vterm" is not performance or dependency count.** It is that a UI which draws a bar cursor, hides the cursor, uses a dotted underline, or narrows a pane with no scrollback gets the truth from vterm and a flattened approximation from xterm.js. Three of those four are ordinary things for a terminal UI to do.

### If you are designing text decoration, read D5 and D2 together

They interact in a way that is easy to miss:

- **D5** means a decoration such as a dotted underline survives on vterm and silently becomes a plain underline on xterm.js. A design that distinguishes two kinds of text *by underline style alone* stops distinguishing them on the reference backend.
- **D2** means the hyperlink target is dropped by **both** backends. Retiring xterm.js fixes D5 and does nothing for D2.

The practical consequence: if a design needs links to be both visually distinct and actually resolvable, D5 is a rendering-path question and D2 is a `Cell`-vocabulary question. Solving the first does not touch the second.

#### Which seam D5 actually applies to

This catches people out, so it is worth being exact. **D5 is a property of the xterm _guest adapter_, not of xterm.js.** Measured at both seams:

- Through the **backend** (`createXtermBackend()` / `session.ts`, read via `getCell()`), xterm.js reports `underline: "dotted"` correctly. Both backends agree, and there is no divergence to worry about.
- Through the **guest adapter** (`xtermGuest`, read via `handle.output.buffer`), the style is flattened to `attrs: { underline: true }` when translating into Silvery's `Cell` vocabulary. vterm carries `underlineStyle` through.

So "dotted underlines collapse under xterm" is true only of the guest path. Since `vtermGuest` is now the sole production guest (`@si/vterm/21016`), a dotted-underline design renders correctly in production. What remains on the xterm guest is **test code** — which inverts the usual failure: the design is right in the product and flattened in the harness, so a test asserting a dotted underline can fail while nothing is actually broken.

### Source

These are executable, not prose-only. Each entry is asserted in `packages/vterm/tests/vterm-guest-differential.test.ts`, which runs both emulators side by side and fails if the divergence *set* changes -- so a fix, a regression, or a new divergence all break the test rather than quietly editing this table's meaning. The header of that file is the authoritative catalog; this section is its readable form.

## Known Divergences

### Emoji width (xterm.js)

xterm.js headless does not report emoji characters as wide (`cell.wide === false`), even though they occupy two columns. CJK characters are reported correctly as wide across all backends. Ghostty and vt100 both correctly report emoji as wide.

**Source**: `cross-backend.test.ts` -- the emoji test conditionally checks `wide` only for ghostty/vt100.

### OSC 2 title

| Backend  | Behavior                                                       |
| -------- | -------------------------------------------------------------- |
| xterm.js | Correctly sets and returns title                               |
| Ghostty  | Always returns `""` (WASM build has no title change callback)  |
| vt100    | Limited OSC support; returns a string but does not parse OSC 2 |

### Scrollback promotion (vt100 and Ghostty)

The most impactful divergence. When a TUI app running in inline mode uses cursor-up (`ESC[A`) to reposition and rewrite screen content (the mechanism behind scrollback promotion), vt100 and Ghostty diverge from xterm.js:

| Symptom                    | Description                                                                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Items lost from scrollback | Cursor-up + content rewrite doesn't preserve previously-written items                                                                                                |
| Screen goes blank          | On small terminals (e.g. 60x10), the screen becomes entirely empty                                                                                                   |
| Footer pushed off screen   | After multiple promotions, the footer (input area) scrolls out of view                                                                                               |
| Cursor-up overshoot        | After promotion, `prevCursorRow` includes frozen line count, causing the next render's cursor-up to overshoot into pre-existing terminal content (shell prompt area) |

These were discovered via `scrollback-cross-backend.fuzz.tsx`, which tees the same ANSI output from a real Silvery app to both xterm.js and vt100 simultaneously. The vt100 divergences match real-world bugs observed in Ghostty.

**Root cause**: Different emulators handle the interaction between cursor-up at the top of the screen, content rewriting, and scroll region tracking differently. xterm.js is more forgiving of cursor-up sequences that reference lines above the current content.

### Capabilities

| Capability       | xterm.js | Ghostty         | vt100 |
| ---------------- | -------- | --------------- | ----- |
| Truecolor        | Yes      | Yes             | Yes   |
| Reflow on resize | Yes      | Yes             | No    |
| Kitty keyboard   | No       | Yes             | No    |
| OSC 8 hyperlinks | Yes      | Yes             | No    |
| Dirty tracking   | No       | Yes (extension) | No    |

## Impact on TUI Apps

These differences matter because TUI apps are tested against xterm.js but run on real terminals (Ghostty, iTerm2, WezTerm, Alacritty, etc.). A sequence that works perfectly in xterm.js may produce visual glitches in other terminals.

The scrollback promotion divergence is the most severe: an app that renders correctly in all xterm.js-based tests can show blank screens, lost content, and jumping UI in Ghostty. This is because inline mode relies on precise cursor repositioning via `ESC[A` (cursor up), which is interpreted differently across emulators.

Ghostty uses the same VT parser as the native Ghostty terminal app, so bugs found via the Ghostty WASM backend are real bugs that users see. The vt100 pure-TS backend, while less accurate overall, reproduces the same class of cursor-up/rewrite divergences -- making it useful as a lightweight proxy for "non-xterm" behavior without requiring WASM initialization.

## Testing Strategy

### Cross-backend conformance (`cross-backend.test.ts`)

Tests individual VT features (text, styles, cursor, modes, scrollback) across all three backends. Each test feeds the same escape sequence to each backend and asserts identical results. Backend-specific exceptions are documented inline (e.g., emoji width, OSC title).

### Tee pattern (`scrollback-cross-backend.fuzz.tsx`)

For complex multi-step interactions like scrollback promotion, a single React app renders ANSI output that is tee'd to multiple backends simultaneously:

```
React app (ScrollbackList)
  └── ANSI output
        ├── xterm.js backend (reference)
        └── vt100 backend (divergence detector)
```

After each action (key press), the test compares screen text, scrollback text, visible item IDs, and footer presence across all backends. Divergences are counted without failing the test (since vt100 is known to diverge), but xterm.js invariants are hard assertions.

This architecture ensures that:

1. Both backends see exactly the same byte stream (no test-vs-real differences)
2. Divergences are detected at the action level (not just final state)
3. The xterm.js reference backend gates CI (must always pass)
4. When the ANSI output is fixed to work across emulators, divergence counts drop to zero and assertions can be tightened

### Running

```bash
# Cross-backend conformance (requires Ghostty WASM)
bun vitest run tests/cross-backend.test.ts

# Cross-backend scrollback fuzz (in a silvery project with termless)
FUZZ=1 bun vitest run tests/features/scrollback-cross-backend.fuzz.tsx
```

## See Also

- [Cross-Backend Conformance](/advanced/compat-matrix) -- test coverage and known differences
- [Multi-Backend Testing](/guide/multi-backend) -- how to run tests against different backends
