/**
 * Ghostty backend for termless.
 *
 * Wraps ghostty-web (Ghostty's VT parser compiled to WASM) to implement
 * the TerminalBackend interface — same Ghostty terminal emulation logic
 * that runs in the native Ghostty app, but headless via WASM.
 *
 * The WASM module requires async loading before use. Two patterns:
 *
 * 1. Pre-load the shared instance (recommended):
 *    ```ts
 *    await initGhostty()
 *    const backend = createGhosttyBackend()
 *    backend.init({ cols: 80, rows: 24 }) // sync — WASM already loaded
 *    ```
 *
 * 2. Inject a pre-loaded instance (for test isolation):
 *    ```ts
 *    const ghostty = await Ghostty.load()
 *    const backend = createGhosttyBackend(undefined, ghostty)
 *    backend.init({ cols: 80, rows: 24 })
 *    ```
 *
 * Calling init() without loading WASM first throws a clear error.
 */

import { Ghostty, type GhosttyTerminal, type GhosttyCell, CellFlags } from "ghostty-web"
import { createHash } from "node:crypto"
import { readFileSync, realpathSync } from "node:fs"
import { resolveGhosttyWebWasm } from "./load-native.ts"
import type {
  TerminalBackend,
  TerminalOptions,
  Cell,
  Cursor,
  ScrollbackState,
  TerminalCapabilities,
  Color,
  EmulatorWarning,
  WarningExtension,
  HyperlinkExtension,
  ScreenshotOptions,
} from "../../../src/terminal/types.ts"
import type { Mode } from "@termless/core/io"
// MUST come from the @termless/core package specifier, not the monorepo-
// relative path: the warning registry is STATEFUL, and a relative import gets
// inlined into this package's published bundle — giving ghostty a private
// registry while consumers drain @termless/core's (silvery fresh-clone bug,
// km vendor-CI seam 2026-07-02). Pure helpers may inline; state must not.
import { pushWarning } from "@termless/core"
import { encodeKeyToAnsi } from "../../../src/terminal/key-encoding.ts"
import { renderTerminalPng } from "./render.ts"
import type { RenderOptions } from "./render.ts"

// oxlint-disable-next-line typescript/no-deprecated -- The registered adapter still implements this lifecycle.
type LegacyBackend = TerminalBackend

// ═══════════════════════════════════════════════════════
// Shared Ghostty WASM instance
// ═══════════════════════════════════════════════════════

let sharedGhostty: Ghostty | null = null
let initPromise: Promise<Ghostty> | null = null
let loadedWasm: { path: string; sha256: string } | null = null

/** Internal measurement of the exact WASM file supplied to Ghostty.load. */
export function loadedGhosttyWasm(): { path: string; sha256: string } {
  if (!sharedGhostty || !loadedWasm) throw new Error("Ghostty WASM has not loaded")
  return loadedWasm
}

/**
 * Initialize the shared Ghostty WASM module. Safe to call multiple times —
 * returns the same instance after first load.
 *
 * Must be called (and awaited) before `createGhosttyBackend().init()`.
 * The `init()` method on the backend is synchronous — this async step
 * loads the WASM binary so that `init()` can create terminals without awaiting.
 */
export async function initGhostty(): Promise<Ghostty> {
  if (sharedGhostty) return sharedGhostty
  if (initPromise) return initPromise

  ;(globalThis as { self?: unknown }).self ??= globalThis
  const path = realpathSync(resolveGhosttyWebWasm())
  const bytes = readFileSync(path)
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  // ghostty-web's path loader falls through to fetch() in Node/Vitest. A data
  // URL supplies these exact measured bytes in both Bun and Node.
  initPromise = Ghostty.load(`data:application/wasm;base64,${bytes.toString("base64")}`).then((g) => {
    if (createHash("sha256").update(readFileSync(path)).digest("hex") !== sha256) {
      throw new Error(`Ghostty WASM changed while loading: ${path}`)
    }
    sharedGhostty = g
    loadedWasm = { path, sha256 }
    return g
  })

  return initPromise
}

/**
 * Reset the shared Ghostty instance. For testing only — allows verifying
 * the "WASM not loaded" error path.
 * @internal
 */
export function _resetSharedForTesting(): void {
  sharedGhostty = null
  initPromise = null
  loadedWasm = null
}

// ═══════════════════════════════════════════════════════
// Cell conversion
// ═══════════════════════════════════════════════════════

const UNDERLINE_STYLES = [false, "single", "double", "curly", "dotted", "dashed"] as const

function underlineStyle(cell: GhosttyCell, digest: string | undefined): Cell["underline"] {
  const ordinal = cell.underline_style
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= UNDERLINE_STYLES.length) {
    const producer = digest ?? "unmeasured injected instance"
    throw new Error(
      `Ghostty producer ${producer} returned invalid underline_style ${String(ordinal)}; expected integer 0..5`,
    )
  }
  return UNDERLINE_STYLES[ordinal as 0 | 1 | 2 | 3 | 4 | 5]
}

/** Check if an fg/bg matches the terminal's default colors (= "no explicit color set") */
function isDefaultColor(r: number, g: number, b: number, defaults: { fg: Color; bg: Color }, isFg: boolean): boolean {
  const d = isFg ? defaults.fg : defaults.bg
  return r === d.r && g === d.g && b === d.b
}

function convertGhosttyCell(
  cell: GhosttyCell,
  ghosttyTerm: GhosttyTerminal,
  row: number,
  col: number,
  defaults: { fg: Color; bg: Color },
  producerDigest: string | undefined,
  hyperlink: string | null,
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
  const fg: Color | null = isDefaultColor(cell.fg_r, cell.fg_g, cell.fg_b, defaults, true)
    ? null
    : { r: cell.fg_r, g: cell.fg_g, b: cell.fg_b }

  const bg: Color | null = isDefaultColor(cell.bg_r, cell.bg_g, cell.bg_b, defaults, false)
    ? null
    : { r: cell.bg_r, g: cell.bg_g, b: cell.bg_b }

  return {
    char: text,
    fg,
    bg,
    bold: (cell.flags & CellFlags.BOLD) !== 0,
    dim: (cell.flags & CellFlags.FAINT) !== 0,
    italic: (cell.flags & CellFlags.ITALIC) !== 0,
    underline: underlineStyle(cell, producerDigest),
    underlineColor: null,
    strikethrough: (cell.flags & CellFlags.STRIKETHROUGH) !== 0,
    inverse: (cell.flags & CellFlags.INVERSE) !== 0,
    blink: (cell.flags & CellFlags.BLINK) !== 0,
    overline: null,
    hidden: (cell.flags & CellFlags.INVISIBLE) !== 0,
    wide: cell.width > 1,
    continuation: false,
    hyperlink,
  }
}

function convertScrollbackCell(
  cell: GhosttyCell,
  ghosttyTerm: GhosttyTerminal,
  offset: number,
  col: number,
  defaults: { fg: Color; bg: Color },
  producerDigest: string | undefined,
  hyperlink: string | null,
): Cell {
  let text: string
  if (cell.grapheme_len > 0) {
    text = ghosttyTerm.getScrollbackGraphemeString(offset, col)
  } else if (cell.codepoint === 0) {
    text = ""
  } else {
    text = String.fromCodePoint(cell.codepoint)
  }

  const fg: Color | null = isDefaultColor(cell.fg_r, cell.fg_g, cell.fg_b, defaults, true)
    ? null
    : { r: cell.fg_r, g: cell.fg_g, b: cell.fg_b }

  const bg: Color | null = isDefaultColor(cell.bg_r, cell.bg_g, cell.bg_b, defaults, false)
    ? null
    : { r: cell.bg_r, g: cell.bg_g, b: cell.bg_b }

  return {
    char: text,
    fg,
    bg,
    bold: (cell.flags & CellFlags.BOLD) !== 0,
    dim: (cell.flags & CellFlags.FAINT) !== 0,
    italic: (cell.flags & CellFlags.ITALIC) !== 0,
    underline: underlineStyle(cell, producerDigest),
    underlineColor: null,
    strikethrough: (cell.flags & CellFlags.STRIKETHROUGH) !== 0,
    inverse: (cell.flags & CellFlags.INVERSE) !== 0,
    blink: (cell.flags & CellFlags.BLINK) !== 0,
    overline: null,
    hidden: (cell.flags & CellFlags.INVISIBLE) !== 0,
    wide: cell.width > 1,
    continuation: false,
    hyperlink,
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
 * emulation. The WASM module must be loaded before calling init() —
 * either via `await initGhostty()` (shared) or by passing a pre-loaded
 * instance directly.
 *
 * @param opts - Optional terminal dimensions (unused — init() takes dimensions)
 * @param ghostty - Optional pre-loaded Ghostty instance (for test isolation).
 *   Falls back to the shared instance from initGhostty().
 */
export function createGhosttyBackend(
  opts?: Partial<TerminalOptions>,
  ghostty?: Ghostty,
): LegacyBackend & WarningExtension & HyperlinkExtension {
  let term: GhosttyTerminal | null = null
  const ghosttyInstance: Ghostty | null = ghostty ?? sharedGhostty
  const producerDigest = ghosttyInstance === sharedGhostty ? loadedWasm?.sha256 : undefined
  let cols = DEFAULT_COLS
  let rows = DEFAULT_ROWS
  let defaultColors: { fg: Color; bg: Color } = {
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
    if (categoryMatch?.[1]) {
      const category = categoryMatch[1].toUpperCase()
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
      throw new Error(
        "Ghostty WASM not loaded — call `await initGhostty()` before init(), " +
          "or pass a pre-loaded Ghostty instance to createGhosttyBackend().",
      )
    }

    cols = options.cols
    rows = options.rows

    term = ghosttyInstance.createTerminal(cols, rows, {
      scrollbackLimit: options.scrollbackLimit ?? 1000,
    })

    // ghostty-web's WASM `createTerminal` recycles freed buffer memory, so a
    // fresh terminal can inherit the previous one's cell grid. Send RIS
    // (Reset to Initial State) immediately so every `init()` starts from a
    // guaranteed-blank screen — critical when multiple ghostty-backed
    // terminals run in one process (e.g. cross-backend canvas compare).
    term.write("\x1bc")

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
    // ghostty-web's write() RangeErrors on a zero-length buffer; zero bytes
    // is a semantic no-op for every other backend, so keep parity here.
    if (data.length === 0) return
    const t = ensureTerm()

    withWarningCapture(() => {
      t.write(data)
      t.update() // Sync render state
    })

    if (backend.onResponse) {
      // Drain DA1/DA2/DSR + native window-op responses
      while (t.hasResponse()) {
        const response = t.readResponse()
        if (response) {
          backend.onResponse(new TextEncoder().encode(response))
        }
      }
    }
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
      const cell = cells[col]
      if (!cell) throw new Error(`Missing Ghostty cell at ${lineIndex}:${col}`)
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

  function emptyCell(): Cell {
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
      overline: null,
      hidden: false,
      wide: false,
      continuation: false,
      hyperlink: null,
    }
  }

  function absoluteLine(row: number): Cell[] {
    const t = ensureTerm()
    t.update()
    const scrollbackLen = t.getScrollbackLength()
    const totalRows = scrollbackLen + rows
    if (row < 0 || row >= totalRows) return Array.from({ length: cols }, () => emptyCell())
    const cells = row < scrollbackLen ? t.getScrollbackLine(row) : t.getLine(row - scrollbackLen)
    if (!cells) return Array.from({ length: cols }, () => emptyCell())
    return cells.map((cell, col) => {
      // URI lookup uses absolute rows; live grapheme lookup remains relative to the screen.
      const hyperlink = t.getHyperlinkAt(row, col)
      return row < scrollbackLen
        ? convertScrollbackCell(cell, t, row, col, defaultColors, producerDigest, hyperlink)
        : convertGhosttyCell(cell, t, row - scrollbackLen, col, defaultColors, producerDigest, hyperlink)
    })
  }

  function getTextRange(startRow: number, startCol: number, endRow: number, endCol: number): string {
    const parts: string[] = []

    for (let row = startRow; row <= endRow; row++) {
      const cells = absoluteLine(row)
      if (!cells) continue

      const colStart = row === startRow ? startCol : 0
      const colEnd = row === endRow ? endCol : cells.length

      let line = ""
      for (let col = colStart; col < colEnd; col++) {
        const cell = cells[col]
        if (!cell || cell.char === "") continue
        line += cell.char
      }
      parts.push(line.replace(/\s+$/, ""))
    }

    return parts.join("\n")
  }

  function getCell(row: number, col: number): Cell {
    return absoluteLine(row)[col] ?? emptyCell()
  }

  function getHyperlinkAt(row: number, col: number): string | null {
    return getCell(row, col).hyperlink
  }

  function getLine(row: number): Cell[] {
    return absoluteLine(row)
  }

  function getLines(): Cell[][] {
    const result: Cell[][] = []
    const t = ensureTerm()
    t.update()
    const totalRows = t.getScrollbackLength() + rows
    for (let row = 0; row < totalRows; row++) {
      result.push(getLine(row))
    }
    return result
  }

  function getCursor(): Cursor {
    const t = ensureTerm()
    t.update()
    const cursor = t.getCursor()
    const rawVisible: unknown = cursor.visible
    return {
      col: cursor.x,
      row: cursor.y,
      // oxlint-disable-next-line typescript/no-deprecated -- Legacy cursor alias required by TerminalBackend.
      x: cursor.x,
      // oxlint-disable-next-line typescript/no-deprecated -- Legacy cursor alias required by TerminalBackend.
      y: cursor.y,
      visible: rawVisible === true || rawVisible === 1 ? true : rawVisible === false || rawVisible === 0 ? false : null,
      style: "block", // Ghostty WASM doesn't expose cursor style directly
    }
  }

  function getMode(mode: Mode): boolean {
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
        return t.getMode(66) // DECNKM (DEC private mode 66)
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
    return ensureTerm().getTitle()
  }

  function getScrollback(): ScrollbackState {
    const t = ensureTerm()
    t.update()
    // The core page list owns the viewport; read it, never assume the bottom.
    const { totalRows, viewportTop, screenRows } = t.getViewportState()
    return {
      viewportTop,
      totalRows,
      screenRows,
      // oxlint-disable-next-line typescript/no-deprecated -- Legacy scrollback alias required by TerminalBackend.
      viewportOffset: viewportTop,
      // oxlint-disable-next-line typescript/no-deprecated -- Legacy scrollback alias required by TerminalBackend.
      totalLines: totalRows,
      // oxlint-disable-next-line typescript/no-deprecated -- Legacy scrollback alias required by TerminalBackend.
      screenLines: screenRows,
    }
  }

  function scrollViewport(delta: number): void {
    ensureTerm().scrollViewport(delta)
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
    extensions: new Set(["dirtyTracking", "warnings", "hyperlinks"]),
  }

  function getWarnings(): EmulatorWarning[] {
    return [...warnings]
  }

  function clearWarnings(): void {
    warnings.length = 0
  }

  /**
   * Native screenshot path — render this backend's current cell state via
   * `@termless/ghostty`'s `renderTerminalPng` (CanvasRenderer + napi-rs/canvas).
   *
   * Wires `Terminal.screenshot()`'s auto-picker step 1: when the backend is
   * ghostty, we can render in-process without a cells round-trip detour
   * through another parser. The renderer still consumes `cellsToAnsi(this)`
   * internally — that's the same VT engine that produced these cells, so
   * the round-trip is lossless.
   */
  async function screenshot(opts?: ScreenshotOptions): Promise<Uint8Array> {
    // ScreenshotOptions and RenderOptions are kept structurally compatible
    // by hand (see core/types.ts § ScreenshotOptions). Cast through unknown
    // to bridge the two declared types without dragging RenderOptions into
    // core (which would cycle: core ← ghostty ← core).
    return renderTerminalPng(backend, opts as RenderOptions | undefined)
  }

  const backend: LegacyBackend & WarningExtension & HyperlinkExtension = {
    name: "ghostty",
    init,
    destroy,
    feed,
    resize,
    reset,
    getText,
    getTextRange,
    getCell,
    getHyperlinkAt,
    // oxlint-disable-next-line typescript/no-deprecated -- Legacy method required by TerminalBackend.
    getLine,
    // oxlint-disable-next-line typescript/no-deprecated -- Legacy method required by TerminalBackend.
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
    getWarnings,
    clearWarnings,
    screenshot,
  }

  return backend
}
