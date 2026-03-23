# @termless/census

Terminal capability census — probe backends for feature support, generate a compatibility matrix.

## Usage

```bash
bun census                      # run all probes against installed backends
```

Results are written to `census/results/current.json` and printed as a summary table.

## How It Works

1. **Probes** (`.probe.ts` files) feed specific ANSI escape sequences to each backend
2. Each probe uses standard vitest `expect()` assertions
3. Results are determined from test status:
   - Test passes → supported (true)
   - Test fails → not supported (false)
   - Failed expect messages are captured as notes
4. `report.ts` parses vitest JSON output and builds the feature × backend matrix

## Adding Probes

Create a new `.probe.ts` file in `probes/` using `describeBackends()` from `_backends.ts`:

```typescript
import { describeBackends, feed, test, expect, notes } from "./_backends.ts"

describeBackends("my-category", (b) => {
  test("category.feature.detail", () => {
    feed(b, "\x1b[...some sequence...")
    expect(b.getCell(0, 0).bold).toBe(true)
  })
})
```

Test IDs use dot-path notation (`sgr.bold`, `cursor.move.absolute`). Hierarchy is derived from dots for rollup display.

## Categories

| Category   | What's tested                                                  |
| ---------- | -------------------------------------------------------------- |
| sgr        | Bold, italic, underline variants, colors, strikethrough, blink |
| cursor     | CUP, movement, hide/show, save/restore                         |
| mode       | Alt screen, bracketed paste, mouse tracking, auto-wrap         |
| scrollback | Accumulation, scroll regions, reverse index                    |
| text       | Basic rendering, wrap, wide chars, emoji, tabs                 |
| erase      | Line erase, screen erase                                       |
| extension  | Kitty keyboard/graphics, sixel, OSC 8, reflow, truecolor       |
| reset      | SGR reset, RIS, backend reset()                                |
