# @termless/census

Terminal capability census -- probe backends for feature support, generate a compatibility matrix.

## Usage

```bash
bun census                      # run all probes against installed backends
```

Results are written to `census/results/current.json` and printed as a summary table.

## How It Works

1. **Probes** (`.probe.ts` files) feed specific ANSI escape sequences to each backend
2. Each probe uses `check()` assertions that record pass/fail without throwing
3. Results are determined from check state:
   - All checks pass --> **yes** (test passes)
   - Some checks pass, some fail --> **partial** (test fails with `[census:partial]` prefix)
   - All checks fail --> **no** (test fails with `[census:no]` prefix)
   - Uncaught error --> **error** (probe bug)
4. `report.ts` parses vitest JSON output and builds the feature x backend matrix

## Adding Probes

Create a new `.probe.ts` file in `probes/` using the `census()` helper from `_backends.ts`:

```typescript
import { census, feed } from "./_backends.ts"

census("my-category", { spec: "ECMA-48 section" }, (b, test) => {
  test("feature-id", { meta: { description: "Human name" } }, ({ check }) => {
    feed(b, "\x1b[...some sequence...")
    check(b.getCell(0, 0).bold, "has bold").toBe(true)
  })
})
```

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
