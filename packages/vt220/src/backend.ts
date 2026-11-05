/**
 * Pure TypeScript VT220 backend for termless.
 *
 * Wraps the vt220.js screen emulator to implement the TerminalBackend interface.
 * Extends VT100 with insert/delete characters/lines,
 * insert mode (IRM), selective erase (DECSED/DECSEL), and soft reset (DECSTR).
 */

import { adapterDeclaration, replyDelivery } from "./reply-delivery.ts"
import { createVt220Screen as createScreen, type ScreenCell, type Vt220Screen as Screen } from "vt220.js"
import type {
  AdapterSourcesExtension,
  PasteEncodingExtension,
  OscMetadataExtension,
  TerminalBackend,
  ReplyDeliveryExtension,
  TerminalOptions,
  Cell,
  Cursor,
  TerminalMode,
  ScrollbackState,
  TerminalCapabilities,
} from "../../../src/terminal/types.ts"
import { encodeKeyToAnsi } from "../../../src/terminal/key-encoding.ts"

// ═══════════════════════════════════════════════════════
// Backend factory
// ═══════════════════════════════════════════════════════

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

/**
 * Create a pure TypeScript VT220 backend for termless.
 *
 * Extends VT100 with insert mode (IRM),
 * insert/delete characters (ICH/DCH), insert/delete lines (IL/DL),
 * erase characters (ECH), selective erase (DECSED/DECSEL),
 * and soft reset (DECSTR). No color, hidden text, or wide
 * chars — use vterm.js for those.
 */
export function createVt220Backend(
  opts?: Partial<TerminalOptions>,
): TerminalBackend & ReplyDeliveryExtension & AdapterSourcesExtension & PasteEncodingExtension & OscMetadataExtension {
  let screen: Screen | null = null

  function ensureScreen(): Screen {
    if (!screen) throw new Error("vt220 backend not initialized — call init() first")
    return screen
  }

  function init(options: TerminalOptions): void {
    screen = createScreen({
      cols: options.cols,
      rows: options.rows,
      scrollbackLimit: options.scrollbackLimit ?? 1000,
      onResponse: (data: string) => {
        if (backend.onResponse) {
          backend.onResponse(new TextEncoder().encode(data))
        }
      },
    })
  }

  // Eagerly init if opts provided
  if (opts) {
    init({
      cols: opts.cols ?? DEFAULT_COLS,
      rows: opts.rows ?? DEFAULT_ROWS,
      scrollbackLimit: opts.scrollbackLimit,
    })
  }

  function destroy(): void {
    screen = null
  }

  function feed(data: Uint8Array): void {
    ensureScreen().process(data)
  }

  function resize(cols: number, rows: number): void {
    ensureScreen().resize(cols, rows)
  }

  function reset(): void {
    ensureScreen().reset()
  }

  function emptyCell(): Cell {
    return {
      char: "",
      fg: null,
      bg: null,
      bold: false,
      dim: null,
      italic: null,
      underline: false,
      underlineColor: null,
      strikethrough: null,
      inverse: false,
      blink: false,
      overline: null,
      hidden: false,
      wide: false,
      continuation: false,
      hyperlink: null,
    }
  }

  function convertCell(sc: ScreenCell): Cell {
    return {
      char: sc.char,
      fg: sc.fg,
      bg: sc.bg,
      bold: sc.bold,
      dim: null,
      italic: null,
      underline: sc.underline ? "single" : false,
      underlineColor: null,
      strikethrough: null,
      inverse: sc.inverse,
      blink: sc.blink,
      overline: null,
      hidden: sc.hidden,
      wide: false,
      continuation: false,
      hyperlink: null,
    }
  }

  function snapshotRows(): Cell[][] {
    const snap = ensureScreen().snapshot()
    const rows: Cell[][] = new Array(snap.scrollback.length + snap.grid.length)
    for (let row = 0; row < snap.scrollback.length; row++) {
      rows[row] = snap.scrollback[row]!.map(convertCell)
    }
    for (let row = 0; row < snap.grid.length; row++) {
      rows[snap.scrollback.length + row] = snap.grid[row]!.map(convertCell)
    }
    return rows
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
      parts.push(
        cells
          .slice(start, end)
          .map((cell) => cell.char || " ")
          .join("")
          .replace(/\s+$/, ""),
      )
    }
    return parts.join("\n")
  }

  function getCell(row: number, col: number): Cell {
    return getLine(row)[col] ?? emptyCell()
  }

  function getLine(row: number): Cell[] {
    return snapshotRows()[row] ?? Array.from({ length: ensureScreen().cols }, () => emptyCell())
  }

  function getLines(): Cell[][] {
    return snapshotRows()
  }

  function getCursor(): Cursor {
    const s = ensureScreen()
    const pos = s.getCursorPosition()
    return {
      col: pos.x,
      row: pos.y,
      x: pos.x,
      y: pos.y,
      visible: s.getCursorVisible(),
      style: "block",
    }
  }

  function getMode(mode: TerminalMode): boolean | null {
    return ensureScreen().getMode(mode)
  }

  function getTitle(): string {
    return ensureScreen().getTitle()
  }

  function getScrollback(): ScrollbackState {
    const s = ensureScreen()
    const scrollbackLength = s.getScrollbackLength()
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
    name: "vt220",
    version: "0.13.0",
    truecolor: false,
    kittyKeyboard: false,
    kittyGraphics: false,
    sixel: false,
    osc8Hyperlinks: false,
    semanticPrompts: false,
    unicode: "1.0",
    reflow: false,
    extensions: new Set(["adapter-sources", "reply-delivery", "paste-encoding", "osc-metadata"]),
  }

  const backend: TerminalBackend &
    ReplyDeliveryExtension &
    AdapterSourcesExtension &
    PasteEncodingExtension &
    OscMetadataExtension = {
    getAdapterSources: () => adapterDeclaration.sources,
    name: "vt220",
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
    getUnhandledSequences: () => ensureScreen().getUnhandledSequences(),
    getScrollback,
    scrollViewport,
    encodeKey: encodeKeyToAnsi,
    encodePaste(text) {
      return ensureScreen().encodePaste(text)
    },
    capabilities,
    replyDelivery,
  }

  return backend
}
