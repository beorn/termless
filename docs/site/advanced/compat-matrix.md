# Cross-Backend Conformance

termless verifies that all backends (xterm.js, Ghostty, vt100) produce identical results for the same VT100/ECMA-48 input sequences. Differences between backends are bugs — this is how we find and fix them.

## Test Coverage

The `cross-backend.test.ts` suite runs 120+ tests across all backends, covering:

| Category                     | What's tested                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Text rendering**           | Plain text, multiline, CUP positioning, line wrap at boundary                                                  |
| **Cell styles (SGR)**        | Bold, italic, faint, strikethrough, inverse, underline, truecolor FG/BG, 256-color, combined styles, SGR reset |
| **Cursor**                   | Position after text, after CRLF, CUP, CUF forward                                                              |
| **Modes**                    | Alt screen toggle, bracketed paste, auto wrap, application cursor, mouse tracking, focus tracking              |
| **Wide characters**          | Emoji width, CJK characters, column offset after wide chars                                                    |
| **Scrollback**               | Screen lines reported, scrollback accumulation                                                                 |
| **Reset**                    | `reset()` method, RIS (`\ec`) escape sequence                                                                  |
| **Capabilities**             | Truecolor, reflow, Kitty keyboard                                                                              |
| **Key encoding**             | Enter, Escape, Ctrl+C, ArrowUp                                                                                 |
| **Cross-backend comparison** | Cell-by-cell text, cursor position, and style attribute comparison between xterm.js and Ghostty                |

## Running

```bash
bun vitest run vendor/termless/tests/cross-backend.test.ts --project vendor
```

## Known Differences

- **Emoji width**: xterm.js headless does not report emoji as wide (CJK works correctly)
- **Kitty keyboard**: Ghostty supports it, xterm.js and vt100 do not
- **OSC title**: Ghostty WASM has no title change callback; vt100 backend has limited OSC support
