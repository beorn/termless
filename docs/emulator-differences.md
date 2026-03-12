# Terminal Emulator Differences

Termless backends wrap different terminal emulators, each with its own VT parser implementation. This document records the known behavioral divergences discovered through cross-backend testing.

## Backends

| Backend | Emulator | Implementation | Reflow | Kitty Keyboard | OSC 8 |
| ------- | -------- | -------------- | ------ | -------------- | ----- |
| `@termless/xtermjs` | xterm.js 5.5.0 | `@xterm/headless` (WASM) | Yes | No | Yes |
| `@termless/ghostty` | Ghostty 0.4.0 | `ghostty-web` (WASM) | Yes | Yes | Yes |
| `@termless/vt100` | Pure TypeScript | Zero native deps | No | No | No |

xterm.js is the **reference backend** -- it has the widest adoption, passes the most conformance tests, and is what Silvery's test infrastructure (`createTermless()`) uses by default. Divergences from xterm.js are considered bugs in the other backend or in our ANSI output.

## Known Divergences

### Emoji width (xterm.js)

xterm.js headless does not report emoji characters as wide (`cell.wide === false`), even though they occupy two columns. CJK characters are reported correctly as wide across all backends. Ghostty and vt100 both correctly report emoji as wide.

**Source**: `cross-backend.test.ts` -- the emoji test conditionally checks `wide` only for ghostty/vt100.

### OSC 2 title

| Backend | Behavior |
| ------- | -------- |
| xterm.js | Correctly sets and returns title |
| Ghostty | Always returns `""` (WASM build has no title change callback) |
| vt100 | Limited OSC support; returns a string but does not parse OSC 2 |

### Scrollback promotion (vt100 and Ghostty)

The most impactful divergence. When a TUI app running in inline mode uses cursor-up (`ESC[A`) to reposition and rewrite screen content (the mechanism behind scrollback promotion), vt100 and Ghostty diverge from xterm.js:

| Symptom | Description |
| ------- | ----------- |
| Items lost from scrollback | Cursor-up + content rewrite doesn't preserve previously-written items |
| Screen goes blank | On small terminals (e.g. 60x10), the screen becomes entirely empty |
| Footer pushed off screen | After multiple promotions, the footer (input area) scrolls out of view |
| Cursor-up overshoot | After promotion, `prevCursorRow` includes frozen line count, causing the next render's cursor-up to overshoot into pre-existing terminal content (shell prompt area) |

These were discovered via `scrollback-cross-backend.fuzz.tsx`, which tees the same ANSI output from a real Silvery app to both xterm.js and vt100 simultaneously. The vt100 divergences match real-world bugs observed in Ghostty.

**Root cause**: Different emulators handle the interaction between cursor-up at the top of the screen, content rewriting, and scroll region tracking differently. xterm.js is more forgiving of cursor-up sequences that reference lines above the current content.

### Capabilities

| Capability | xterm.js | Ghostty | vt100 |
| ---------- | -------- | ------- | ----- |
| Truecolor | Yes | Yes | Yes |
| Reflow on resize | Yes | Yes | No |
| Kitty keyboard | No | Yes | No |
| OSC 8 hyperlinks | Yes | Yes | No |
| Dirty tracking | No | Yes (extension) | No |

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

# Cross-backend scrollback fuzz (xterm.js + vt100, no WASM needed)
FUZZ=1 bun vitest run vendor/silvery/tests/features/scrollback-cross-backend.fuzz.tsx
```

## See Also

- [Cross-Backend Conformance](/advanced/compat-matrix) -- test coverage and known differences
- [Multi-Backend Testing](/guide/multi-backend) -- how to run tests against different backends
