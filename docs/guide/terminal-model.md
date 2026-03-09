# Terminal Buffer Model

## The Buffer

A terminal maintains a buffer of character cells organized in rows and columns.

```
┌─────────────────────────┐
│ scrollback row 0        │ ─┐
│ scrollback row 1        │  │ scrollback (history)
│ ...                     │  │
│ scrollback row N        │ ─┘
├─────────────────────────┤ ← base
│ screen row 0            │ ─┐
│ screen row 1            │  │ screen (rows × cols)
│ ...                     │  │
│ screen row (rows-1)     │ ─┘
└─────────────────────────┘
```

## Regions

| Region     | What it is                                                                                               | Empty when      |
| ---------- | -------------------------------------------------------------------------------------------------------- | --------------- |
| screen     | The fixed rows × cols grid. What the terminal renders.                                                   | Never           |
| scrollback | Lines that scrolled off the top of the screen.                                                           | Alt screen mode |
| buffer     | Everything: scrollback + screen.                                                                         | Never           |
| viewport   | What's visible at the current scroll position. At bottom: same as screen. Scrolled up: shows scrollback. | Never           |

## Normal Mode vs Alt Mode

Two separate buffers, not regions within one:

- **Normal mode** (default): Primary buffer. Output scrolls, scrollback accumulates above the screen. Used by shells, build tools, inline CLI.
- **Alt mode** (`\x1b[?1049h`): Separate clean `rows × cols` buffer, no scrollback. Used by fullscreen apps (vim, htop, km). Entering saves normal buffer; exiting restores it.

| Region     | Normal mode              | Alt mode          |
| ---------- | ------------------------ | ----------------- |
| screen     | Bottom rows × cols       | Entire alt buffer |
| scrollback | Lines above screen       | Empty             |
| buffer     | scrollback + screen      | = screen          |
| viewport   | Window at viewportOffset | = screen          |

## Cross-Reference: Terminology by Terminal

### Core buffer model (well-documented internals)

| Concept          | Termless                      | Ghostty                                | Kitty                              | xterm.js                  |
| ---------------- | ----------------------------- | -------------------------------------- | ---------------------------------- | ------------------------- |
| Visible area     | **screen**                    | screen (screen coordinates)            | screen (`@screen`)                 | viewport (viewportY)      |
| History above    | **scrollback**                | scrollback buffer                      | scrollback / history buffer        | scrollback                |
| Everything       | **buffer**                    | absolute buffer (absolute coordinates) | text (`@text` = screen+scrollback) | buffer (`buffer.active`)  |
| Alt screen       | **altScreen** mode            | alternate screen buffer                | secondary screen (`@alternate`)    | alternate (`buffer.type`) |
| Scroll position  | **viewport** / viewportOffset | viewportY (0=bottom)                   | scrolled_by                        | viewportY (0=bottom)      |
| Single character | **cell**                      | GhosttyCell                            | CPUCell / GPUCell                  | IBufferCell               |
| Character row    | **row**                       | row                                    | line (LineBuf)                     | line (IBufferLine)        |

### Additional terminals (implement VT100/ECMA-48 buffer model)

All modern terminals implement the same underlying buffer model (normal + alternate screen, scrollback region). The table below shows how they expose these concepts:

| Terminal             | Visible area   | Scrollback               | Alt screen       | Notes                                                               |
| -------------------- | -------------- | ------------------------ | ---------------- | ------------------------------------------------------------------- |
| **WezTerm**          | viewport       | scrollback               | alternate        | Cross-platform, xterm-compatible. Uses "viewport" for visible area. |
| **iTerm2**           | session window | scrollback buffer        | alternate screen | macOS. "Session" = a terminal instance.                             |
| **foot**             | grid/window    | scrollback               | alternate        | Wayland-native, Kitty KB. Minimalist internals.                     |
| **Alacritty**        | display/grid   | history                  | alternate        | GPU-accelerated. `grid.rs` manages the buffer.                      |
| **xterm** (classic)  | screen         | saved lines / scrollback | alternate screen | The original reference terminal. ECMA-48.                           |
| **Terminal.app**     | window         | scrollback               | alternate screen | macOS built-in. 256-color only, limited features.                   |
| **tmux**             | pane window    | history                  | alternate        | Multiplexer. Adds its own scrollback on top of terminal's.          |
| **VS Code Terminal** | (xterm.js)     | (xterm.js)               | (xterm.js)       | Embedded xterm.js — same internals.                                 |
| **Contour**          | viewport       | scrollback               | alternate        | Modern terminal with DEC 2026 sync support.                         |
| **Windows Terminal** | viewport       | scrollback               | alternate screen | Uses ConPTY + its own VT parser.                                    |

### Silvery (km) — UI framework layer

Silvery operates at a higher level (React component tree → rendered cells), not terminal emulation:

| Concept           | silvery term          | Notes                                                     |
| ----------------- | --------------------- | --------------------------------------------------------- |
| Visible area      | `board.screen`        | The rendered component tree output                        |
| Scroll position   | viewport offset       | In ScrollbackView, VirtualView, VirtualList               |
| Single character  | cell                  | In the output buffer                                      |
| Alt screen        | fullscreen mode       | `render(<App />, { fullscreen: true })`                   |
| Coordinate system | `(x, y)` column-first | CSS/DOM convention — different from Termless `(row, col)` |

### Standards

| Standard                                                                                               | Relevance                                                                              |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| [ECMA-48 / ISO 6429](https://www.ecma-international.org/publications-and-standards/standards/ecma-48/) | CSI/OSC sequences — the foundation. Defines SGR, cursor control, screen modes.         |
| [XTerm Control Sequences](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html)                     | De facto terminal standard. Extends ECMA-48 with mouse, paste, true color, alt screen. |
| `smcup`/`rmcup` (terminfo)                                                                             | Enter/exit alternate screen — `\x1b[?1049h` / `\x1b[?1049l`.                           |
| [DEC 2026](https://gist.github.com/christianparpart/d8a62cc1ab659194337d73e399004036)                  | Synchronized output — batch rendering to prevent tearing.                              |
| [Kitty Keyboard Protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/)                          | Unambiguous key identification. Supported by Ghostty, Kitty, WezTerm, foot.            |
| [OSC 8 Hyperlinks](https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda)                 | Clickable hyperlinks in terminal output.                                               |

See also `vendor/silvery/docs/reference/terminal-matrix.md` for the full capability matrix (colors, keyboard protocol, graphics, clipboard) across all terminals.

## Coordinate Systems

- **Termless**: `(row, col)` — row-first, 0-based. Matches terminal tradition (ANSI sequences are row-first: `\x1b[row;colH`).
- **Ghostty**: 4 coordinate systems (viewport, screen, scrollback, absolute), all row-first.
- **xterm.js**: `(y, x)` — row-first internally (`IBufferLine`).
- **Silvery**: `(x, y)` — column-first, matching CSS/DOM convention (`left`, `top`).

Silvery keeps `(x, y)` because it's a React-like UI framework where CSS conventions are natural. Termless keeps `(row, col)` because it's a terminal emulator library. Don't unify — each is correct for its domain.

## Cell

A cell holds one character with attributes:

- text, fg (RGB), bg (RGB)
- bold, faint, italic, underline, strikethrough, inverse, wide
