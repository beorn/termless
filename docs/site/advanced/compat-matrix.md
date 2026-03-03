# Cross-Terminal Conformance Matrix

Generated: 2026-03-03
Backends: xterm.js, ghostty

## Summary

| Metric | Count |
|--------|-------|
| Total tests | 36 |
| All backends pass | 35 |
| Any backend fails | 1 |
| Backends differ | 2 |

## Text

| Test | xterm.js | ghostty | Match |
|------|------| ------| ------|
| Plain text | ok: Hello, world! | ok: Hello, world! | = |
| Multiline (CRLF) | ok: 3 lines | ok: 3 lines | = |
| CUP positioning (\e[3;10H) | ok: cell(2,9)=X | ok: cell(2,9)=X | = |
| Line wrap at boundary | ok: wrapped | ok: wrapped | = |

## SGR

| Test | xterm.js | ghostty | Match |
|------|------| ------| ------|
| Bold (SGR 1) | ok: B bold | ok: B bold | = |
| Faint (SGR 2) | ok: F faint | ok: F faint | = |
| Italic (SGR 3) | ok: I italic | ok: I italic | = |
| Underline (SGR 4) | ok: U underline:single | ok: U underline:single | = |
| Strikethrough (SGR 9) | ok: S strike | ok: S strike | = |
| Inverse (SGR 7) | ok: I inverse | ok: I inverse | = |
| True color FG (SGR 38;2) | ok: fg:rgb(255,128,0) | ok: fg:rgb(255,128,0) | = |
| True color BG (SGR 48;2) | ok: bg:rgb(0,128,255) | ok: bg:rgb(0,128,255) | = |
| Combined bold+italic+fg | ok: X bold italic fg:rgb(255,0,0) | ok: X bold italic fg:rgb(255,0,0) | = |
| Reset (SGR 0) clears all | ok: P | ok: P | = |
| 256-color FG (SGR 38;5;196 = red) | ok: fg:rgb(255,0,0) | ok: fg:rgb(255,0,0) | = |

## Cursor

| Test | xterm.js | ghostty | Match |
|------|------| ------| ------|
| Position after text | ok: (5,0) | ok: (5,0) | = |
| Position after CRLF | ok: (5,1) | ok: (5,1) | = |
| CUP (\e[5;10H) | ok: (9,4) | ok: (9,4) | = |
| CUF forward (\e[5C) | ok: x=5 | ok: x=5 | = |

## Modes

| Test | xterm.js | ghostty | Match |
|------|------| ------| ------|
| Alt screen on | ok: true | ok: true | = |
| Alt screen off | ok: false | ok: false | = |
| Bracketed paste | ok: true | ok: true | = |
| Auto wrap (default on) | ok: true | ok: true | = |

## Scrollback

| Test | xterm.js | ghostty | Match |
|------|------| ------| ------|
| Screen lines reported | ok: screenLines=24 | ok: screenLines=24 | = |
| Scrollback accumulates | ok: totalLines=30 | ok: totalLines=30 | = |

## Control

| Test | xterm.js | ghostty | Match |
|------|------| ------| ------|
| RIS clears screen | ok: cleared | ok: cleared | = |
| Resize preserves content | ok: preserved | ok: preserved | = |

## Keys

| Test | xterm.js | ghostty | Match |
|------|------| ------| ------|
| Enter → CR (0x0d) | ok: [0xd] | ok: [0xd] | = |
| Escape → ESC (0x1b) | ok: [0x1b] | ok: [0x1b] | = |
| Ctrl+C → ETX (0x03) | ok: [0x3] | ok: [0x3] | = |
| ArrowUp → \e[A | ok: "\u001b[A" | ok: "\u001b[A" | = |

## Unicode

| Test | xterm.js | ghostty | Match |
|------|------| ------| ------|
| Wide emoji | FAIL: wide=false text="🎉" | ok: wide=true text="🎉" | DIFF |
| CJK character | ok: wide=true text="漢" | ok: wide=true text="漢" | = |

## Capabilities

| Test | xterm.js | ghostty | Match |
|------|------| ------| ------|
| True color support | ok: true | ok: true | = |
| Reflow support | ok: true | ok: true | = |
| Kitty keyboard | ok: false | ok: true | DIFF |

## Known Differences

### Unicode: Wide emoji

- xterm.js: wide=false text="🎉"
- ghostty: wide=true text="🎉"

### Capabilities: Kitty keyboard

- xterm.js: false
- ghostty: true
