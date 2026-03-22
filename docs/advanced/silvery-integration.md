# Silvery Test Leverage Plan: Termless Opportunities

Assessment of where Termless can augment or replace silvery's virtual buffer tests.

## Current State

Silvery has ~170 test files. The primary testing approach is virtual buffer testing via `createRenderer` from `@silvery/term/testing`, which renders React components to an in-memory `TerminalBuffer` and asserts against plain text (`app.text`) or buffer cells (`app.term.cell(x, y)`).

5 files already use Termless:

- `inline-termless.test.ts` -- inline mode output phase verified through real terminal
- `output-termless.test.ts` -- fullscreen diff/style output verified through real terminal
- `scrollback-termless.test.ts` -- scrollback promotion, cursor tracking, content shrink
- `scrollback-list-termless.test.tsx` -- ScrollbackList border integrity in frozen items
- `scrollback-promotion-termless.test.tsx` -- promotion path border integrity, compaction

These existing Termless tests all share the same pattern: take ANSI output from silvery's output phase (or `renderString`/`stdout.write`), feed it to a Termless terminal, and verify the result in the real terminal emulator. This catches bugs that string/buffer inspection misses.

## Test Categories and Assessment

### Category 1: Output Phase / ANSI Generation (HIGH VALUE)

**Files:** `output.test.ts`, `output-diff-fuzz.test.tsx`, `output-truecolor-diff.test.tsx`, `output-emoji-incremental.test.tsx`, `output-emoji-replay.test.ts`, `output-wide-char-fuzz.test.tsx`, `pipeline.test.ts`, `pipeline/content-phase-clear.test.tsx`, `pipeline/content-phase-scroll-incremental.test.tsx`, `pipeline/cursor-inverse-clear.test.tsx`, `pipeline/virtual-text-dirty-flags.test.tsx`

**Current approach:** Most tests inspect raw ANSI strings (checking for specific escape sequences) or use `replayAnsiWithStyles` (silvery's own ANSI replay function). The fuzz tests compare incremental vs fresh render via `replayAnsiWithStyles`.

**Termless value: VERY HIGH.** These tests are the #1 leverage opportunity. The existing virtual buffer tests verify that silvery _thinks_ it produced correct output, but the replay is silvery's own code. A Termless terminal is independent verification -- if silvery's ANSI is wrong in a way that `replayAnsiWithStyles` also gets wrong (same bug in both), the virtual test passes but the real terminal is garbled. This is exactly the class of bug that `output-termless.test.ts` already catches.

**Approach: AUGMENT.** Keep the fast virtual buffer tests for regression speed. Add Termless companion tests for high-risk paths:

- Style transition output (SGR diff minimization)
- True-color round-trip (RGB values survive ANSI encoding/decoding)
- Wide char + emoji cursor advancement
- Incremental diff correctness (the most critical: diff produces garbled output that `replayAnsiWithStyles` doesn't catch)

**Effort: MEDIUM.** The pattern is established by `output-termless.test.ts`. Each new test creates a `TerminalBuffer`, calls `outputPhase()`, feeds result to Termless, asserts with `term.cell()` / `term.screen`. ~2-4 hours to add 10-15 high-value tests.

---

### Category 2: Wide Characters / CJK / Emoji (HIGH VALUE)

**Files:** `wide-char-diff.test.tsx`, `wide-char-shift.test.tsx`, `wide-char-truncate.test.ts`, `wide-terminal-repro.test.tsx`, `cjk-wide-char.test.tsx`, `output-emoji-incremental.test.tsx`, `output-emoji-replay.test.ts`, `unicode.test.ts`

**Current approach:** Buffer-level cell inspection (`app.term.cell()`) and ANSI replay verification. Some tests use `compareBuffers` for incremental vs fresh matching.

**Termless value: HIGH.** Wide character handling is one of the most terminal-dependent behaviors. Different terminals handle continuation cells, cursor advancement after wide chars, and wide-to-narrow transitions differently. xterm.js (Termless's backend) provides ground truth for how a real terminal interprets the ANSI output. Bugs like cursor drift after emoji, orphaned continuation cells, and boundary splitting are invisible to buffer inspection but visible in a real terminal.

**Approach: AUGMENT.** Keep buffer-level tests for fast regression. Add Termless tests that:

- Feed emoji/CJK ANSI output to Termless and verify `cell().toBeWide()`
- Verify cursor position after wide char sequences: `term.toHaveCursorAt(x, y)`
- Verify incremental diff of wide chars (change emoji A to emoji B) produces correct terminal state
- Verify wide char at container boundary (the Asana import scenario from `cjk-wide-char.test.tsx`)

**Effort: MEDIUM.** ~2-3 hours for 8-10 tests. Pattern is straightforward: render component, get ANSI, feed to Termless, check `toBeWide()` and cursor position.

---

### Category 3: Incremental Rendering / Stale Pixels / Ghost Characters (HIGH VALUE)

**Files:** `incremental-stale-pixels.test.tsx`, `ghost-chars.test.tsx`, `text-shrink-ghost.test.tsx`, `border-toggle-regression.test.tsx`, `text-truncate-rerender.test.tsx`, `rerender-bugs.test.tsx`, `rerender-height.test.tsx`, `rerender-memo.test.tsx`, `rerender-scroll-shrink.test.tsx`, `rerender-virtuallist.test.tsx`, `abs-pos-incremental.test.tsx`, `border-only-incremental.test.tsx`, `single-pass-rerender.test.tsx`, `rendercount-verification-gap.test.tsx`

**Current approach:** Virtual buffer comparison (incremental vs fresh render via `compareBuffers`/`assertBuffersMatch`), plain text assertions, ANSI replay via `VirtualTerminal`.

**Termless value: HIGH.** The core question is: does the incremental ANSI diff, when applied to a real terminal that already has the previous frame, produce the same result as a fresh render? Currently these tests use silvery's own `VirtualTerminal.applyAnsi()` as the verifier. Termless provides independent verification. The `ghost-chars.test.tsx` file specifically notes that "the buffer is correct but the terminal doesn't receive all the necessary updates" -- this is precisely what Termless catches.

**Approach: AUGMENT.** The virtual buffer tests are fast (~50ms each) and good for CI. Add Termless companion tests for the known-problematic scenarios:

- Content shrink leaving stale text (the ghost char bug)
- Border toggle (add/remove `borderStyle`) leaving stale border characters
- Truncate rerender leaving stale characters at end of line
- Conditional child removal in `flexGrow` containers

**Effort: MEDIUM.** ~3-4 hours for 10-12 tests. Pattern: render frame 1 to Termless, render frame 2 (get diff ANSI), feed diff to same terminal, verify no stale content with `term.screen.getText()` and `not.toContainText()`.

---

### Category 4: Style / Color Rendering (MEDIUM VALUE)

**Files:** `style-merge.test.ts`, `style-transitions.test.tsx`, `bg-inheritance.test.ts`, `text-bg-bleed.test.tsx`, `no-color.test.tsx`, `border-dim-color.test.tsx`, `detail-pane-border.test.tsx`, `theming.test.tsx`, `link-dim.test.tsx`, `terminal-colors.test.ts`

**Current approach:** ANSI string inspection (`app.ansi.toContain("38;5;1")`) and buffer cell inspection (`app.term.cell(x, y).fg`).

**Termless value: MEDIUM.** Current tests verify that the correct SGR codes appear in the ANSI output and that buffer cells have the right color values. Termless adds the ability to verify that a real terminal _interprets_ those SGR codes correctly -- e.g., that a style transition from `bold red` to `dim blue` actually results in dim blue (not dim red, due to a missing reset). The `output-termless.test.ts` already tests basic color round-tripping.

**Approach: AUGMENT.** Add Termless tests for the riskiest color scenarios:

- Style transitions on the same row (SGR minimization producing wrong results)
- Background color inheritance through nested components (the `bg-bleed` bug)
- True-color vs 256-color vs 16-color fallback
- `inverse` attribute (terminal-dependent rendering)

**Effort: LOW-MEDIUM.** ~2 hours for 6-8 tests. The `toHaveFg()`, `toHaveBg()`, `toBeBold()` matchers make assertions easy.

---

### Category 5: Scroll / Overflow (MEDIUM VALUE)

**Files:** `scroll-dirty.test.tsx`, `scroll-offscreen-render.test.tsx`, `scroll-visible-range-change.test.tsx`, `scroll-region.test.ts`, `scroll-utils.test.ts`, `strict-scroll-garble.test.tsx`, `strict-virtuallist-garble.test.tsx`, `overflow-hidden-horizontal.test.tsx`, `overflow-position.test.tsx`, `overflow-spurious.test.tsx`

**Current approach:** Virtual buffer comparison, `SILVERY_STRICT` mode for incremental vs fresh verification, buffer text assertions.

**Termless value: MEDIUM.** Scroll regions (`DECSTBM`) are terminal-dependent. The `scroll-region.test.ts` only checks that correct escape sequences are emitted (mock stdout). Termless can verify that scroll region operations (scroll up/down within a region) actually produce the expected terminal state. The garble tests (`strict-scroll-garble`, `strict-virtuallist-garble`) verify buffer consistency but not terminal output.

**Approach: AUGMENT.** Specific opportunities:

- Scroll region (DECSTBM) operations: set region, scroll up/down, verify terminal content
- Overflow clipping: verify clipped content is truly invisible in terminal
- VirtualList scroll: verify that scrolling a virtual list produces correct output in terminal

**Effort: MEDIUM.** ~2-3 hours for 6-8 tests. Scroll regions need care since xterm.js handles DECSTBM.

---

### Category 6: Inline Mode (ALREADY COVERED)

**Files:** `inline-mode.test.ts`, `inline-termless.test.ts`, `inline-output.bench.ts`, `scrollback-inline.test.tsx`

**Current state:** `inline-termless.test.ts` already provides excellent Termless coverage for inline mode. `inline-mode.test.ts` inspects ANSI escape sequences directly (cursor-up counts, erase-to-EOL counts, cursor positioning suffix).

**Termless value: ALREADY LEVERAGED.** The existing Termless test covers content shrink, scrollback offset handling, height capping, and multi-frame incremental consistency. Could add a few more tests for edge cases:

- Cursor visibility in inline mode (show/hide at correct positions)
- Inline mode with styled content (bold, colors preserved across frames)

**Effort: LOW.** ~1 hour for 2-3 additional tests. Existing pattern is well-established.

---

### Category 7: Scrollback / ScrollbackList / ScrollbackView (ALREADY COVERED)

**Files:** `scrollback.test.tsx`, `scrollback-resize.test.tsx`, `scrollback-width.test.tsx`, `scrollback-view.test.tsx`, `scrollback-list.test.tsx`, `scrollback-inline.test.tsx`, `scrollback-termless.test.ts`, `scrollback-list-termless.test.tsx`, `scrollback-promotion-termless.test.tsx`

**Current state:** Three Termless test files already provide thorough coverage for scrollback promotion, ScrollbackList border integrity, and compaction. The virtual buffer tests cover width handling, resize behavior, and view scrolling.

**Termless value: ALREADY LEVERAGED.** The existing coverage is excellent. Minor gaps:

- Scrollback resize (verify terminal handles width change during scrollback)
- ScrollbackView scroll navigation (verify viewport position after scroll operations)

**Effort: LOW.** ~1 hour for 2-3 tests.

---

### Category 8: Components (LOW-MEDIUM VALUE)

**Files:** `components.test.tsx`, `app.test.tsx`, `hooks.test.tsx`, `textarea.test.tsx`, `input.test.tsx`, `input-coalescing.test.tsx`, `input-isolation.test.tsx`, `input-layer.test.tsx`, `virtual-list.test.tsx`, `virtual-view.test.tsx`, `horizontal-virtual-list.test.tsx`, `use-virtualizer.test.tsx`, `image.test.tsx`, `fill.test.tsx`, `fill-perf.test.tsx`, `screen.test.tsx`, `with-commands.test.tsx`, `with-diagnostics.test.tsx`, `split-view.test.tsx`, `sticky.test.tsx`, `animation.test.tsx`, `suspense-embed.test.tsx`, `suspense-flicker.test.tsx`, `react-compat.test.tsx`, `react19.test.tsx`, `ink-compat.test.tsx`, `use-edit-context.test.tsx`, `hit-registry.test.tsx`, `mouse-events.test.tsx`, `auto-locator.test.tsx`, `locator.test.ts`, `zoom-mismatch.test.tsx`

**Current approach:** `createRenderer` with `app.text`, `app.press()`, `app.locator()`.

**Termless value: LOW-MEDIUM.** Component tests verify behavior (state changes on input, correct text output). These work well with the virtual buffer. Termless would add value only where the component's visual output has terminal-dependent behavior (wide chars in TextInput, cursor positioning, background fills). Most component logic tests don't need terminal verification.

**Approach: LEAVE AS-IS.** The virtual buffer testing is well-suited for component behavior. Only add Termless for specific visual concerns (e.g., VirtualList with wide-char items, TextArea cursor positioning).

**Effort: N/A (not recommended as a bulk effort).**

---

### Category 9: Layout (LOW VALUE)

**Files:** `layout-engines.test.ts`, `layout-engine.test.ts`, `layout-equivalence.test.tsx`, `layout-property.test.tsx`, `layout-snapshots.test.tsx`, `single-pass-layout.test.tsx`, `flexbox-grow.test.tsx`, `flexgrow-*.test.tsx` (7 files), `flexily-nested-box-bug.test.tsx`, `bottom-bar-layout.test.tsx`, `console-layout-cascade.test.tsx`, `display-none.test.tsx`, `measureElement.test.tsx`, `onlayout-corruption.test.tsx`

**Current approach:** Virtual buffer, layout property assertions, snapshot comparisons.

**Termless value: LOW.** Layout is computed before ANSI generation. The buffer accurately represents what the terminal will show for layout purposes. Layout bugs are visible in the buffer. Termless would not catch layout bugs that the buffer misses.

**Approach: LEAVE AS-IS.**

---

### Category 10: Input / Keys / Mouse (LOW VALUE)

**Files:** `keys.test.ts`, `kitty-keyboard.test.ts`, `kitty-detect.test.ts`, `kitty-auto.test.ts`, `mouse.test.ts`, `mouse-runtime.test.ts`, `mouse-events.test.tsx`, `focus-*.test.ts` (5 files), `split-raw-input.spec.ts`, `bracketed-paste.test.ts`, `clipboard.test.ts`, `ime.test.tsx`

**Current approach:** Unit tests for parsing/encoding, mock streams for protocol detection.

**Termless value: LOW.** Input parsing is pure data transformation (bytes to parsed key objects). The virtual tests are correct and fast. Termless adds value only for end-to-end input processing (spawn a real app, send keys, verify response), which is the TTY MCP domain rather than unit testing.

**Approach: LEAVE AS-IS.**

---

### Category 11: Terminal Capabilities / Lifecycle / Compat (LOW VALUE)

**Files:** `terminal-caps.test.ts`, `terminal-lifecycle.test.ts`, `terminal-lifecycle-integration.test.tsx`, `terminal-multiplexers.test.ts`, `terminal-compat/*.test.ts`, `device-attrs.test.ts`, `pixel-size.test.ts`, `mode-query.test.ts`, `cursor-query.test.ts`, `window-title.test.ts`, `hyperlink.test.ts`, `osc7.test.ts`, `osc-palette.test.ts`, `notifications.test.ts`

**Current approach:** Mock streams, ANSI sequence assertions, protocol parsing.

**Termless value: LOW for most. MEDIUM for terminal mode verification.** Most tests verify escape sequence generation/parsing, which is pure logic. However, Termless could verify that mode-setting sequences (alt screen, cursor visibility, mouse tracking, bracketed paste) actually have the expected effect on the terminal state. The `toBeInMode()` matcher is purpose-built for this.

**Approach: AUGMENT SELECTIVELY.** Add Termless tests for mode verification:

- `enterAlternateScreen()` -> `expect(term).toBeInMode("altScreen")`
- `enableMouse()` -> `expect(term).toBeInMode("mouseTracking")`
- `enableBracketedPaste()` -> `expect(term).toBeInMode("bracketedPaste")`
- Cursor hide/show -> `expect(term).toHaveCursorHidden()` / `toHaveCursorVisible()`

**Effort: LOW.** ~1 hour for 5-6 tests. Very mechanical.

---

### Category 12: Buffer / Cell Operations (VERY LOW VALUE)

**Files:** `buffer.test.ts`, `render.test.ts`, `render-adapter.test.ts`, `canvas-adapter.test.ts`, `canvas-e2e.test.tsx`, `dom-adapter.test.ts`, `dom-e2e.test.tsx`, `debug-mismatch.test.ts`, `text-ops.test.ts`, `text-cursor.test.ts`, `text-sizing.test.ts`, `edit-context.test.ts`, `text-edge-cases.test.tsx`

**Current approach:** Pure unit tests for data structures and algorithms.

**Termless value: VERY LOW.** These test internal data structures (cell packing, attribute encoding, buffer equality). No terminal interaction involved.

**Approach: LEAVE AS-IS.**

---

### Category 13: State Management / Scheduling / Runtime (VERY LOW VALUE)

**Files:** `tea-store.test.ts`, `create-slice.test.ts`, `scheduler.test.ts`, `sync-update.test.ts`, `act-environment.test.ts`, `runtime/*.test.{ts,tsx}` (11 files), `streams/streams.test.ts`, `pane-manager.test.ts`, `event-loop-exit.test.tsx`, `exit.test.tsx`, `non-tty.test.tsx`, `devtools.test.ts`, `inspector.test.ts`, `examples-*.test.tsx`

**Termless value: NONE.** Pure logic, no terminal output involved.

**Approach: LEAVE AS-IS.**

## Top 10 Highest-Value Opportunities (Ranked)

| #   | Opportunity                                                                                                                                          | Category     | Impact                                                            | Approach | Effort |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------- | -------- | ------ |
| 1   | **Incremental diff correctness via Termless** -- feed prev frame + diff ANSI to same terminal, compare against fresh render fed to a second terminal | Output Phase | Catches ANSI diff bugs invisible to `replayAnsiWithStyles`        | Augment  | 3h     |
| 2   | **Ghost char / stale pixel verification** -- content shrink, border toggle, truncate rerender through real terminal                                  | Incremental  | Verifies the exact bug class that motivated the ghost-char tests  | Augment  | 2h     |
| 3   | **Wide char + emoji cursor drift** -- verify cursor position and cell widths after emoji/CJK sequences in real terminal                              | Wide Chars   | Terminal-dependent behavior; xterm.js is ground truth             | Augment  | 2h     |
| 4   | **Style transition round-trip** -- SGR minimization (bold->dim, red->blue, etc.) verified through `toHaveFg()`, `toBeBold()`                         | Style/Color  | Catches missing resets that `replayAnsiWithStyles` may also miss  | Augment  | 1.5h   |
| 5   | **True-color RGB round-trip** -- verify specific RGB values survive buffer -> ANSI -> terminal                                                       | Style/Color  | Catches palette mapping bugs, truncation                          | Augment  | 1h     |
| 6   | **Background color inheritance across wrapped lines** -- the bg-bleed bug through real terminal                                                      | Style/Color  | Caught a real bug; Termless adds independent verification         | Augment  | 1h     |
| 7   | **Scroll region (DECSTBM) terminal verification** -- set region, scroll, verify content                                                              | Scroll       | Currently only tests escape sequence strings, not terminal effect | Augment  | 2h     |
| 8   | **Terminal mode verification** -- alt screen, mouse, paste, cursor via `toBeInMode()`                                                                | Terminal     | Very cheap to add, verifies protocol sequences work               | Augment  | 1h     |
| 9   | **Wide char at container boundary** -- CJK char split by adjacent container border                                                                   | Wide Chars   | Terminal-specific; the Asana import scenario                      | Augment  | 1h     |
| 10  | **Inline mode cursor positioning** -- verify cursor show/hide/position across frames                                                                 | Inline       | Extends existing `inline-termless.test.ts`                        | Augment  | 1h     |

**Total estimated effort: ~16 hours for all 10 opportunities.**

## Recommended Approach

### 1. Always AUGMENT, Never REPLACE

The virtual buffer tests serve different purposes: they are fast (~50ms vs ~200ms for Termless), they catch buffer-level bugs, and they test internal invariants (incremental vs fresh, cell attributes). Termless tests add a second layer of verification: does the ANSI output produce the expected result in a real terminal?

Keep every existing virtual buffer test. Add Termless tests alongside them for the high-risk paths.

### 2. Pattern: Side-by-Side Files

Follow the existing convention: `foo.test.tsx` (virtual) alongside `foo-termless.test.tsx` (Termless). The Termless tests can share helpers but should be independently runnable.

### 3. Naming Convention

Use the `-termless` suffix: `output-diff-termless.test.tsx`, `ghost-chars-termless.test.tsx`, etc.

### 4. Test Structure Pattern

All Termless tests follow this structure:

```typescript
import { createTerminal } from "@termless/core"
import { createXtermBackend } from "@termless/xtermjs"
import "@termless/test/matchers"

function createTestTerminal(cols: number, rows: number) {
  return createTerminal({
    backend: createXtermBackend({ cols, rows }),
    cols,
    rows,
    scrollbackLimit: 1000,
  })
}

test("description", () => {
  const term = createTestTerminal(80, 24)

  // Feed ANSI from silvery's output phase
  term.feed(enterAlternateScreen())
  term.feed(outputPhase(null, buffer1))
  term.feed(outputPhase(buffer1, buffer2))

  // Assert with Termless matchers
  expect(term.screen).toContainText("expected")
  expect(term.cell(0, 0)).toBeBold()
  expect(term.cell(0, 0)).toHaveFg({ r: 255, g: 0, b: 0 })
  expect(term).toHaveCursorAt(5, 3)

  term.close()
})
```

### 5. Phased Rollout

**Phase 1 (highest impact, ~8h):** Opportunities 1-3 (incremental diff, ghost chars, wide chars). These address the most common real-world bug classes and have the largest gap between virtual buffer coverage and real terminal behavior.

**Phase 2 (medium impact, ~5h):** Opportunities 4-6 (style transitions, true-color, bg-bleed). Solidifies color/style rendering verification.

**Phase 3 (polish, ~3h):** Opportunities 7-10 (scroll regions, terminal modes, container boundary, cursor positioning). Fills remaining gaps.

## Key Insight

The existing 5 Termless test files already demonstrate the highest-value pattern: they test the **output pipeline** -- the code that converts silvery's internal buffer to ANSI escape sequences. This is where the virtual buffer and the real terminal can diverge. The buffer is correct, but the ANSI generation has a subtle bug, and silvery's own ANSI replay (`replayAnsiWithStyles`) has the same bug, so virtual tests pass while the real terminal is garbled.

Every Termless test should target this gap: **does the ANSI output, when interpreted by a real terminal, match what silvery's buffer says should be on screen?**
