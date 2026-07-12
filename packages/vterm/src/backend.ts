/**
 * Full-featured vterm.js backend for termless.
 *
 * Wraps the vterm.js terminal emulator to implement the TerminalBackend interface.
 * Zero external dependencies — all VT/ECMA-48/xterm parsing is done in pure TypeScript.
 * Supports every SGR attribute, cursor shapes, OSC 8 hyperlinks, and more.
 */

import { createVtermScreen as createScreen, type ScreenCell, type VtermScreen as Screen } from "vterm.js"
import type {
  TerminalBackend,
  TerminalOptions,
  Cell,
  CursorState,
  CursorStyle,
  TerminalMode,
  ScrollbackState,
  TerminalCapabilities,
} from "@termless/core"
import { encodeKeyToAnsi, scanWindowOpQueries } from "@termless/core"

// ═══════════════════════════════════════════════════════
// Backend factory
// ═══════════════════════════════════════════════════════

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const BLANK_CELL: Cell = { char: " ", fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, underlineColor: null, strikethrough: false, inverse: false, blink: false, hidden: false, wide: false, continuation: false, hyperlink: null }

/**
 * Create a full-featured vterm.js backend for termless.
 *
 * This is a comprehensive terminal emulator targeting 100% coverage of
 * the terminfo.dev feature matrix. Pure TypeScript, zero dependencies.
 *
 * Supports: All SGR attributes (bold, faint, italic, underline styles,
 * overline, strikethrough, blink, hidden, inverse), 16/256/truecolor,
 * underline color, cursor shapes (DECSCUSR), OSC 8 hyperlinks, all DEC
 * private modes, DA1/DA2/DSR responses, synchronized output, and more.
 */
export function createVtermBackend(opts?: Partial<TerminalOptions>): TerminalBackend {
  let screen: Screen | null = null

  function ensureScreen(): Screen {
    if (!screen) throw new Error("vterm backend not initialized — call init() first")
    return screen
  }

  function init(options: TerminalOptions): void {
    screen = createScreen({
      cols: options.cols,
      rows: options.rows,
      scrollbackLimit: options.scrollbackLimit ?? 1000,
      onResponse: (data: string) => {
        // Forward DA1/DA2/DSR responses to the terminal layer
        if (backend.onResponse) {
          backend.onResponse(new TextEncoder().encode(data))
        }
      },
    })
  }

  function destroy(): void {
    screen = null
  }

  /**
   * Standard cell metrics used for synthetic CSI 14t / 18t window-op
   * responses. vterm.js doesn't carry a window pixel size — it's a pure
   * cell-grid emulator. Synthesize 14t/18t responses so silvery's
   * `resolveMouseOption()` probe sees the expected shape and switches
   * to SGR-Pixels (1016) mouse coordinate mode.
   *
   * 8 × 17 is the typical Iosevka/JetBrains Mono cell at 12pt 96 DPI.
   * What matters is the ratio matches the backend's cell grid
   * (one cell = one cell, invariant).
   */
  const CELL_W_PX = 8
  const CELL_H_PX = 17

  function feed(data: Uint8Array): void {
    const s = ensureScreen()
    s.process(data)

    const onResponse = backend.onResponse
    if (onResponse) {
      const text = new TextDecoder().decode(data)
      scanWindowOpQueries(text, (query) => {
        if (query === "14t") {
          const heightPx = s.rows * CELL_H_PX
          const widthPx = s.cols * CELL_W_PX
          onResponse(new TextEncoder().encode(`\x1b[4;${heightPx};${widthPx}t`))
        } else if (query === "18t") {
          onResponse(new TextEncoder().encode(`\x1b[8;${s.rows};${s.cols}t`))
        } else {
          onResponse(new TextEncoder().encode("\x1b[?997;1n"))
        }
      })
    }
  }

  function resize(cols: number, rows: number): void {
    ensureScreen().resize(cols, rows)
  }

  function reset(): void {
    ensureScreen().reset()
  }

  /** Map vterm screen underline ("none"|"single"|...) to Cell underline (false|"single"|...) */
  function mapUnderline(u: import("vterm.js").UnderlineStyle): Cell["underline"] {
    return u === "none" ? false : u
  }

  /** Map vterm cursor shape to termless CursorStyle */
  function mapCursorShape(shape: "block" | "underline" | "bar"): CursorStyle {
    if (shape === "bar") return "beam"
    return shape
  }

  function convertCell(sc: ScreenCell | undefined): Cell {
    if (!sc) return BLANK_CELL
    return {
      char: sc.char === "" ? " " : sc.char,
      fg: sc.fg,
      bg: sc.bg,
      bold: sc.bold,
      dim: sc.faint,
      italic: sc.italic,
      underline: mapUnderline(sc.underline),
      underlineColor: sc.underlineColor,
      strikethrough: sc.strikethrough,
      inverse: sc.inverse,
      blink: sc.blink,
      hidden: sc.hidden,
      wide: sc.wide,
      continuation: sc.char === "",
      hyperlink: sc.url,
    }
  }

  function convertRow(row: readonly ScreenCell[] | undefined): Cell[] {
    const cells: Cell[] = []
    let prevWide = false
    for (const sc of row ?? []) {
      const continuation = prevWide && sc.char === ""
      cells.push({
        char: continuation ? "" : sc.char === "" ? " " : sc.char,
        fg: sc.fg,
        bg: sc.bg,
        bold: sc.bold,
        dim: sc.faint,
        italic: sc.italic,
        underline: mapUnderline(sc.underline),
        underlineColor: sc.underlineColor,
        strikethrough: sc.strikethrough,
        inverse: sc.inverse,
        blink: sc.blink,
        hidden: sc.hidden,
        wide: sc.wide,
        continuation,
        hyperlink: sc.url,
      })
      prevWide = sc.wide
    }
    return cells
  }

  function snapshotRows(): Cell[][] {
    const snap = ensureScreen().snapshot()
    const scrollback = snap.scrollback
    const grid = snap.activeBuffer === "alt" ? snap.alt.grid : snap.main.grid
    const rows: Cell[][] = new Array(scrollback.length + grid.length)
    for (let row = 0; row < scrollback.length; row++) rows[row] = convertRow(scrollback[row])
    for (let row = 0; row < grid.length; row++) rows[scrollback.length + row] = convertRow(grid[row])
    return rows
  }

  function getCell(row: number, col: number): Cell {
    const rows = snapshotRows()
    return rows[row]?.[col] ?? BLANK_CELL
  }

  function getLine(row: number): Cell[] {
    return snapshotRows()[row] ?? []
  }

  function getLines(): Cell[][] {
    return snapshotRows()
  }

  function getText(): string {
    return snapshotRows()
      .map((row) => row.map((cell) => cell.char || " ").join(""))
      .join("\n")
  }

  function getTextRange(startRow: number, startCol: number, endRow: number, endCol: number): string {
    const rows = snapshotRows()
    const parts: string[] = []
    for (let row = startRow; row <= endRow; row++) {
      const cells = rows[row]
      if (!cells) continue
      const start = row === startRow ? startCol : 0
      const end = row === endRow ? endCol : cells.length
      parts.push(cells.slice(start, end).map((cell) => cell.char || " ").join(""))
    }
    return parts.join("\n")
  }

  function getCursor(): CursorState {
    const s = ensureScreen()
    const pos = s.getCursorPosition()
    return {
      col: pos.x,
      row: pos.y,
      x: pos.x,
      y: pos.y,
      visible: s.getCursorVisible(),
      style: mapCursorShape(s.getCursorShape()),
    }
  }

  function getMode(mode: TerminalMode): boolean {
    return ensureScreen().getMode(mode)
  }

  function getTitle(): string {
    return ensureScreen().getTitle()
  }

  function getScrollback(): ScrollbackState {
    const s = ensureScreen()
    const scrollbackLength = s.getScrollbackLength()
    // Convert relative offset (lines from bottom) to absolute viewport top row.
    // At bottom (relativeOffset=0): absolute = scrollbackLength (= totalLines - screenLines)
    // Scrolled up by N: absolute = scrollbackLength - N
    const relativeOffset = s.getViewportOffset()
    return {
      viewportTop: scrollbackLength - relativeOffset,
      totalRows: scrollbackLength + s.rows,
      screenRows: s.rows,
      viewportOffset: scrollbackLength - relativeOffset,
      totalLines: scrollbackLength + s.rows,
      screenLines: s.rows,
    }
  }

  function scrollViewport(delta: number): void {
    ensureScreen().scrollViewport(delta)
  }

  const capabilities: TerminalCapabilities = {
    name: "vterm",
    version: "0.2.0",

    // Genuinely implemented: parses RGB values, stores on cells, resolves palette
    truecolor: true,

    // Protocol-level support: full push/pop/query state machine (CSI > u / < u / ? u).
    // Flags are stored and queryable; actual key encoding uses them in the host layer
    // (encodeKeyToAnsi reads the mode from the backend).
    kittyKeyboard: true,

    // Protocol-level support: parses APC G sequences, responds to queries with OK.
    // Does not store or render image data — there's no pixel framebuffer in a headless
    // emulator. The handshake works, so apps that probe before sending images get a
    // truthful "I accept this protocol" answer.
    kittyGraphics: true,

    // Parses sixel DCS sequences and preserves raw data via getSixelImages().
    // A host (GUI renderer, test harness) can consume the stored data. No pixel
    // decoding is done — that's the host's job. DA1 reports attribute 4 (sixel)
    // so applications that check before sending sixel data will proceed correctly.
    sixel: true,

    // Genuinely implemented: stores URL on cell attributes via OSC 8
    osc8Hyperlinks: true,

    // Genuinely implemented: stores zone markers (prompt/command/output) from OSC 133/633
    semanticPrompts: true,

    unicode: "15.1",

    // Genuinely implemented: full reflow algorithm with soft-wrap tracking on resize
    reflow: true,

    extensions: new Set([
      "osc52", // Clipboard read/write via OSC 52
      "osc7", // CWD reporting via OSC 7
      "osc9", // Desktop notifications via OSC 9
      "osc4", // Palette set/query (xterm dynamic colors)
      "osc5", // Special color set/query (bold/ul/blink/reverse/italic)
      "osc10", // Default foreground set/query
      "osc11", // Default background set/query
      "osc12", // Cursor color set/query
      "osc17", // Selection background set/query
      "osc19", // Selection foreground set/query
      "osc21", // Kitty key=value color protocol
      "osc104", // Palette reset
      "osc105", // Special color reset
      "osc110", // Reset default fg
      "osc111", // Reset default bg
      "osc112", // Reset cursor color
      "osc117", // Reset selection bg
      "osc119", // Reset selection fg
      "iterm2Images", // iTerm2 inline images (OSC 1337 File=)
      "modifyOtherKeys", // CSI > 4 ; Pm m keyboard mode
    ]),
  }

  const backend: TerminalBackend = {
    name: "vterm",
    init,
    destroy,
    feed,
    resize,
    reset,
    getText,
    getTextRange,
    getCell,
    getLine,
    getLines,
    getRow: getLine,
    getRows: getLines,
    getCursor,
    getMode,
    getTitle,
    getScrollback,
    scrollViewport,
    encodeKey: encodeKeyToAnsi,
    capabilities,
  }

  // Eagerly init if opts provided
  if (opts) {
    backend.init({
      cols: opts.cols ?? DEFAULT_COLS,
      rows: opts.rows ?? DEFAULT_ROWS,
      scrollbackLimit: opts.scrollbackLimit,
    })
  }

  return backend
}
