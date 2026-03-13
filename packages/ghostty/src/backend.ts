/**
 * Ghostty backend for termless.
 *
 * Wraps ghostty-web (Ghostty's VT parser compiled to WASM) to implement
 * the TerminalBackend interface — same Ghostty terminal emulation logic
 * that runs in the native Ghostty app, but headless via WASM.
 *
 * Requires async initialization: call `await initGhostty()` once before
 * creating backends, or use `createGhosttyBackend()` which handles it.
 */

import { Ghostty, type GhosttyTerminal, type GhosttyCell, CellFlags } from "ghostty-web"
import type {
  TerminalBackend,
  TerminalOptions,
  Cell,
  CursorState,
  TerminalMode,
  ScrollbackState,
  TerminalCapabilities,
  RGB,
} from "../../../src/types.ts"
import { encodeKeyToAnsi } from "../../../src/key-encoding.ts"

// ═══════════════════════════════════════════════════════
// Shared Ghostty WASM instance
// ═══════════════════════════════════════════════════════

let sharedGhostty: Ghostty | null = null
let initPromise: Promise<Ghostty> | null = null

/**
 * Initialize the Ghostty WASM module. Safe to call multiple times —
 * returns the same instance after first load.
 */
export async function initGhostty(): Promise<Ghostty> {
  if (sharedGhostty) return sharedGhostty
  if (initPromise) return initPromise

  initPromise = Ghostty.load().then((g) => {
    sharedGhostty = g
    return g
  })

  return initPromise
}

// ═══════════════════════════════════════════════════════
// Cell conversion
// ═══════════════════════════════════════════════════════

/** Check if an fg/bg matches the terminal's default colors (= "no explicit color set") */
function isDefaultColor(r: number, g: number, b: number, defaults: { fg: RGB; bg: RGB }, isFg: boolean): boolean {
  const d = isFg ? defaults.fg : defaults.bg
  return r === d.r && g === d.g && b === d.b
}

function convertGhosttyCell(
  cell: GhosttyCell,
  ghosttyTerm: GhosttyTerminal,
  row: number,
  col: number,
  defaults: { fg: RGB; bg: RGB },
): Cell {
  // Get proper text — use grapheme API for multi-codepoint characters
  let text: string
  if (cell.grapheme_len > 0) {
    text = ghosttyTerm.getGraphemeString(row, col)
  } else if (cell.codepoint === 0) {
    text = ""
  } else {
    text = String.fromCodePoint(cell.codepoint)
  }

  // Map default terminal colors to null (meaning "use default")
  const fg: RGB | null = isDefaultColor(cell.fg_r, cell.fg_g, cell.fg_b, defaults, true)
    ? null
    : { r: cell.fg_r, g: cell.fg_g, b: cell.fg_b }

  const bg: RGB | null = isDefaultColor(cell.bg_r, cell.bg_g, cell.bg_b, defaults, false)
    ? null
    : { r: cell.bg_r, g: cell.bg_g, b: cell.bg_b }

  return {
    text,
    fg,
    bg,
    bold: (cell.flags & CellFlags.BOLD) !== 0,
    faint: (cell.flags & CellFlags.FAINT) !== 0,
    italic: (cell.flags & CellFlags.ITALIC) !== 0,
    underline: (cell.flags & CellFlags.UNDERLINE) !== 0 ? "single" : "none",
    strikethrough: (cell.flags & CellFlags.STRIKETHROUGH) !== 0,
    inverse: (cell.flags & CellFlags.INVERSE) !== 0,
    wide: cell.width > 1,
  }
}

function convertScrollbackCell(
  cell: GhosttyCell,
  ghosttyTerm: GhosttyTerminal,
  offset: number,
  col: number,
  defaults: { fg: RGB; bg: RGB },
): Cell {
  let text: string
  if (cell.grapheme_len > 0) {
    text = ghosttyTerm.getScrollbackGraphemeString(offset, col)
  } else if (cell.codepoint === 0) {
    text = ""
  } else {
    text = String.fromCodePoint(cell.codepoint)
  }

  const fg: RGB | null = isDefaultColor(cell.fg_r, cell.fg_g, cell.fg_b, defaults, true)
    ? null
    : { r: cell.fg_r, g: cell.fg_g, b: cell.fg_b }

  const bg: RGB | null = isDefaultColor(cell.bg_r, cell.bg_g, cell.bg_b, defaults, false)
    ? null
    : { r: cell.bg_r, g: cell.bg_g, b: cell.bg_b }

  return {
    text,
    fg,
    bg,
    bold: (cell.flags & CellFlags.BOLD) !== 0,
    faint: (cell.flags & CellFlags.FAINT) !== 0,
    italic: (cell.flags & CellFlags.ITALIC) !== 0,
    underline: (cell.flags & CellFlags.UNDERLINE) !== 0 ? "single" : "none",
    strikethrough: (cell.flags & CellFlags.STRIKETHROUGH) !== 0,
    inverse: (cell.flags & CellFlags.INVERSE) !== 0,
    wide: cell.width > 1,
  }
}

// ═══════════════════════════════════════════════════════
// Backend factory
// ═══════════════════════════════════════════════════════

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

/**
 * Create a Ghostty backend for termless.
 *
 * Uses ghostty-web (Ghostty's VT parser via WASM) for headless terminal
 * emulation. The WASM module is loaded lazily on first init().
 *
 * @param opts - Optional terminal dimensions for eager initialization
 * @param ghostty - Optional pre-loaded Ghostty instance (for test isolation)
 */
export function createGhosttyBackend(opts?: Partial<TerminalOptions>, ghostty?: Ghostty): TerminalBackend {
  let term: GhosttyTerminal | null = null
  let ghosttyInstance: Ghostty | null = ghostty ?? null
  let cols = DEFAULT_COLS
  let rows = DEFAULT_ROWS
  let title = ""
  let defaultColors: { fg: RGB; bg: RGB } = {
    fg: { r: 0, g: 0, b: 0 },
    bg: { r: 0, g: 0, b: 0 },
  }

  function ensureTerm(): GhosttyTerminal {
    if (!term) throw new Error("ghostty backend not initialized — call init() first")
    return term
  }

  function init(options: TerminalOptions): void {
    if (term) {
      term.free()
    }

    if (!ghosttyInstance) {
      // Ghostty WASM must be loaded before init — use initGhostty() first
      throw new Error(
        "Ghostty WASM not loaded. Call await initGhostty() before creating backends, " +
          "or pass a Ghostty instance to createGhosttyBackend().",
      )
    }

    cols = options.cols
    rows = options.rows
    title = ""

    term = ghosttyInstance.createTerminal(cols, rows, {
      scrollbackLimit: options.scrollbackLimit ?? 1000,
    })

    // Capture default colors so we can distinguish "default" from "explicitly set"
    term.update()
    const colors = term.getColors() as {
      foreground: { r: number; g: number; b: number }
      background: { r: number; g: number; b: number }
    }
    defaultColors = {
      fg: { r: colors.foreground.r, g: colors.foreground.g, b: colors.foreground.b },
      bg: { r: colors.background.r, g: colors.background.g, b: colors.background.b },
    }
  }

  function destroy(): void {
    if (term) {
      term.free()
      term = null
    }
  }

  function feed(data: Uint8Array): void {
    const t = ensureTerm()
    t.write(data)
    t.update() // Sync render state
  }

  function resize(newCols: number, newRows: number): void {
    const t = ensureTerm()
    t.resize(newCols, newRows)
    cols = newCols
    rows = newRows
  }

  function reset(): void {
    const t = ensureTerm()
    // Send RIS (Reset to Initial State)
    t.write("\x1bc")
    t.update()
    title = ""
  }

  function getText(): string {
    const t = ensureTerm()
    t.update()

    const lines: string[] = []

    // Scrollback lines
    const scrollbackLen = t.getScrollbackLength()
    for (let i = 0; i < scrollbackLen; i++) {
      const cells = t.getScrollbackLine(i)
      if (cells) {
        lines.push(cellsToString(cells, t, i, true))
      }
    }

    // Screen lines
    for (let row = 0; row < rows; row++) {
      const cells = t.getLine(row)
      if (cells) {
        lines.push(cellsToString(cells, t, row, false))
      }
    }

    return lines.join("\n")
  }

  function cellsToString(
    cells: GhosttyCell[],
    ghosttyTerm: GhosttyTerminal,
    lineIndex: number,
    isScrollback: boolean,
  ): string {
    let line = ""
    for (let col = 0; col < cells.length; col++) {
      const cell = cells[col]!
      if (cell.width === 0) continue // Skip continuation cells (wide char second half)
      if (cell.grapheme_len > 0) {
        line += isScrollback
          ? ghosttyTerm.getScrollbackGraphemeString(lineIndex, col)
          : ghosttyTerm.getGraphemeString(lineIndex, col)
      } else if (cell.codepoint === 0) {
        line += " "
      } else {
        line += String.fromCodePoint(cell.codepoint)
      }
    }
    return line.replace(/\s+$/, "") // Trim trailing whitespace
  }

  function getTextRange(startRow: number, startCol: number, endRow: number, endCol: number): string {
    const t = ensureTerm()
    t.update()
    const parts: string[] = []

    for (let row = startRow; row <= endRow; row++) {
      const cells = t.getLine(row)
      if (!cells) continue

      const colStart = row === startRow ? startCol : 0
      const colEnd = row === endRow ? endCol : cells.length

      let line = ""
      for (let col = colStart; col < colEnd; col++) {
        const cell = cells[col]
        if (!cell || cell.width === 0) continue
        if (cell.grapheme_len > 0) {
          line += t.getGraphemeString(row, col)
        } else if (cell.codepoint === 0) {
          line += " "
        } else {
          line += String.fromCodePoint(cell.codepoint)
        }
      }
      parts.push(line.replace(/\s+$/, ""))
    }

    return parts.join("\n")
  }

  function getCell(row: number, col: number): Cell {
    const t = ensureTerm()
    t.update()
    const cells = t.getLine(row)
    if (!cells || col >= cells.length) {
      return {
        text: "",
        fg: null,
        bg: null,
        bold: false,
        faint: false,
        italic: false,
        underline: "none",
        strikethrough: false,
        inverse: false,
        wide: false,
      }
    }
    return convertGhosttyCell(cells[col]!, t, row, col, defaultColors)
  }

  function getLine(row: number): Cell[] {
    const t = ensureTerm()
    t.update()
    const ghosttyCells = t.getLine(row)
    if (!ghosttyCells) {
      return Array.from({ length: cols }, () => ({
        text: "",
        fg: null,
        bg: null,
        bold: false,
        faint: false,
        italic: false,
        underline: "none" as const,
        strikethrough: false,
        inverse: false,
        wide: false,
      }))
    }
    return ghosttyCells.map((cell, col) => convertGhosttyCell(cell, t, row, col, defaultColors))
  }

  function getLines(): Cell[][] {
    const result: Cell[][] = []
    for (let row = 0; row < rows; row++) {
      result.push(getLine(row))
    }
    return result
  }

  function getCursor(): CursorState {
    const t = ensureTerm()
    t.update()
    const cursor = t.getCursor()
    return {
      x: cursor.x,
      y: cursor.y,
      visible: cursor.visible,
      style: "block", // Ghostty WASM doesn't expose cursor style directly
    }
  }

  function getMode(mode: TerminalMode): boolean {
    const t = ensureTerm()

    switch (mode) {
      case "altScreen":
        return t.isAlternateScreen()
      case "cursorVisible":
        return t.getMode(25) // DECTCEM
      case "bracketedPaste":
        return t.hasBracketedPaste()
      case "applicationCursor":
        return t.getMode(1) // DECCKM
      case "applicationKeypad":
        return t.getMode(66, true) // DECNKM (ANSI mode)
      case "autoWrap":
        return t.getMode(7) // DECAWM
      case "mouseTracking":
        return t.hasMouseTracking()
      case "focusTracking":
        return t.hasFocusEvents()
      case "originMode":
        return t.getMode(6) // DECOM
      case "insertMode":
        return t.getMode(4, true) // IRM (ANSI mode)
      case "reverseVideo":
        return t.getMode(5) // DECSCNM
    }
  }

  function getTitle(): string {
    return title
  }

  function getScrollback(): ScrollbackState {
    const t = ensureTerm()
    t.update()
    const scrollbackLength = t.getScrollbackLength()
    return {
      // Ghostty WASM doesn't expose viewport scroll position in headless mode,
      // so assume viewport is at the bottom (absolute top row = scrollbackLength).
      viewportOffset: scrollbackLength,
      totalLines: scrollbackLength + rows,
      screenLines: rows,
    }
  }

  function scrollViewport(_delta: number): void {
    // Ghostty WASM doesn't support viewport scrolling in headless mode
    // (no scroll position state without a renderer)
  }

  const capabilities: TerminalCapabilities = {
    name: "ghostty",
    version: "0.4.0",
    truecolor: true,
    kittyKeyboard: true,
    kittyGraphics: false, // Not available in WASM build
    sixel: false,
    osc8Hyperlinks: true,
    semanticPrompts: false,
    unicode: "15.1",
    reflow: true,
    extensions: new Set(["dirtyTracking"]),
  }

  return {
    name: "ghostty",
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
    getCursor,
    getMode,
    getTitle,
    getScrollback,
    scrollViewport,
    encodeKey: encodeKeyToAnsi,
    capabilities,
  }
}
