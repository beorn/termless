# @termless/census

Terminal capability census — probe backends for feature support, generate a compatibility matrix.

## Usage

```bash
bun census                      # run all probes against installed backends
bun census --backend ghostty    # probe one backend
bun census --json               # raw JSON to stdout
bun census --output results.json
```

## How It Works

1. **Probes** feed specific ANSI escape sequences to each backend
2. Each probe checks whether the feature works correctly
3. Results: yes, partial, no, unknown
4. Output is a JSON database of features x backends

## Adding Probes

Edit `src/probes.ts` and re-run `bun census`.

## Categories

| Category | What's tested |
|----------|---------------|
| sgr | Bold, italic, underline variants, colors, strikethrough, blink |
| cursor | CUP, movement, hide/show, save/restore |
| mode | Alt screen, bracketed paste, mouse tracking, auto-wrap |
| scrollback | Accumulation, scroll regions, reverse index |
| text | Basic rendering, wrap, wide chars, emoji, tabs |
| erase | Line erase, screen erase |
| extension | Kitty keyboard/graphics, sixel, OSC 8, reflow, truecolor |
| reset | SGR reset, RIS, backend reset() |
