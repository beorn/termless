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
  EmulatorWarning,
  WarningExtension,
} from "../../../src/types.ts"
import { pushWarning } from "../../../src/warnings.ts"
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
    char: text,
    fg,
    bg,
    bold: (cell.flags & CellFlags.BOLD) !== 0,
    dim: (cell.flags & CellFlags.FAINT) !== 0,
    italic: (cell.flags & CellFlags.ITALIC) !== 0,
    underline: (cell.flags & CellFlags.UNDERLINE) !== 0 ? "single" : false,
    underlineColor: null,
    strikethrough: (cell.flags & CellFlags.STRIKETHROUGH) !== 0,
    inverse: (cell.flags & CellFlags.INVERSE) !== 0,
    blink: false,
    hidden: false,
    wide: cell.width > 1,
    continuation: false,
    hyperlink: null,
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
    char: text,
    fg,
    bg,
    bold: (cell.flags & CellFlags.BOLD) !== 0,
    dim: (cell.flags & CellFlags.FAINT) !== 0,
    italic: (cell.flags & CellFlags.ITALIC) !== 0,
    underline: (cell.flags & CellFlags.UNDERLINE) !== 0 ? "single" : false,
    underlineColor: null,
    strikethrough: (cell.flags & CellFlags.STRIKETHROUGH) !== 0,
    inverse: (cell.flags & CellFlags.INVERSE) !== 0,
    blink: false,
    hidden: false,
    wide: cell.width > 1,
    continuation: false,
    hyperlink: null,
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
export function createGhosttyBackend(
  opts?: Partial<TerminalOptions>,
  ghostty?: Ghostty,
): TerminalBackend & WarningExtension {
  let term: GhosttyTerminal | null = null
  let ghosttyInstance: Ghostty | null = ghostty ?? sharedGhostty
  let cols = DEFAULT_COLS
  let rows = DEFAULT_ROWS
  let title = ""
  let defaultColors: { fg: RGB; bg: RGB } = {
    fg: { r: 0, g: 0, b: 0 },
    bg: { r: 0, g: 0, b: 0 },
  }

  // ── Warning capture ──
  const warnings: EmulatorWarning[] = []

  /**
   * Parse a [ghostty-vt] log message into a structured EmulatorWarning.
   * Ghostty WASM routes all VT parser messages through console.log("[ghostty-vt]", message).
   *
   * Known message formats from Ghostty:
   * - "warning(osc): invalid OSC command: 66;w=2;X"
   * - "warning(csi): ..."
   * - "warning(esc): ..."
   */
  function parseGhosttyWarning(message: string): EmulatorWarning {
    // Classify by Ghostty's warning(category) format
    const categoryMatch = message.match(/warning\((osc|csi|esc|dcs|pm|apc|sos)\)/i)
    if (categoryMatch) {
      const category = categoryMatch[1]!.toUpperCase()
      return { code: `UNSUPPORTED_${category}`, message, backend: "ghostty" }
    }

    // Legacy format fallback: "unsupported OSC: 66"
    if (/unsupported\s+osc/i.test(message)) {
      return { code: "UNSUPPORTED_OSC", message, backend: "ghostty" }
    }
    if (/unsupported\s+csi/i.test(message)) {
      return { code: "UNSUPPORTED_CSI", message, backend: "ghostty" }
    }
    if (/unsupported\s+(esc|escape)/i.test(message)) {
      return { code: "UNSUPPORTED_ESC", message, backend: "ghostty" }
    }

    // Fallback: any unclassified ghostty-vt message
    return { code: "EMULATOR_LOG", message, backend: "ghostty" }
  }

  /**
   * Execute a function while intercepting console.log for [ghostty-vt] messages.
   * Messages are captured as structured warnings instead of going to the console.
   * Warnings are pushed to both the local backend array and the global registry.
   */
  function withWarningCapture<T>(fn: () => T): T {
    const originalLog = console.log
    console.log = (...args: unknown[]) => {
      if (typeof args[0] === "string" && args[0] === "[ghostty-vt]" && typeof args[1] === "string") {
        const warning = parseGhosttyWarning(args[1])
        warnings.push(warning)
        pushWarning(warning)
        return
      }
      originalLog.apply(console, args)
    }
    try {
      return fn()
    } finally {
      console.log = originalLog
    }
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
    withWarningCapture(() => {
      t.write(data)
      t.update() // Sync render state
    })
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
        char: "",
        fg: null,
        bg: null,
        bold: false,
        dim: false,
        italic: false,
        underline: false,
        underlineColor: null,
        strikethrough: false,
        inverse: false,
        blink: false,
        hidden: false,
        wide: false,
        continuation: false,
        hyperlink: null,
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
        char: "",
        fg: null,
        bg: null,
        bold: false,
        dim: false,
        italic: false,
        underline: false as const,
        underlineColor: null,
        strikethrough: false,
        inverse: false,
        blink: false,
        hidden: false,
        wide: false,
        continuation: false,
        hyperlink: null,
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
    extensions: new Set(["dirtyTracking", "warnings"]),
  }

  function getWarnings(): EmulatorWarning[] {
    return [...warnings]
  }

  function clearWarnings(): void {
    warnings.length = 0
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
    getWarnings,
    clearWarnings,
  }
}
