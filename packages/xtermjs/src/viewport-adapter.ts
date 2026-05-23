/**
 * XtermAdapter — `@silvery/ag` ForeignSource implementation that wraps
 * `@xterm/headless` for embedding a PTY mirror inside a silvery `<Viewport>`.
 *
 * Termless rec-live-overlay paints chrome (recording badge, hotkey hints) via
 * silvery and mounts the PTY content inside a `<Viewport source={XtermAdapter}>`,
 * structurally bypassing silvery's bg-coherence invariant for the foreign cells.
 *
 * Lifecycle: silvery calls `connect(ctx)` on mount and `disconnect()` on unmount.
 * Between those, the adapter feeds ANSI bytes from the PTY child into its
 * private xterm.js Terminal, then mirrors the post-write buffer into the
 * Viewport via `ctx.blit()`. Cursor moves and title changes are forwarded
 * verbatim.
 *
 * On `connect()` the adapter calls `ctx.requestInputMode(opts.captureInput)`
 * (default `"none"`) so the parent host knows whether to route key/mouse
 * events into the Viewport. xterm's `onData` event (the encoded byte stream
 * the embedded Terminal would send back to a PTY) is forwarded to
 * `opts.child.stdin` for the `"keys"`/`"all"` modes; the host's own
 * key-event-into-Viewport wiring (the inverse direction) will land via the
 * Phase A reconciler work tracked in `@km/silvery/15513`.
 *
 * Design rationale: bead `@km/silvery/15513-surface-nested-composition-primitive`.
 */

import xtermPkg from "@xterm/headless"
import { Unicode11Addon } from "@xterm/addon-unicode11"

import type { Cell, CellAttrs } from "@silvery/ag/types"
import type {
  CellBuffer,
  ForeignSource,
  ViewportContext,
  ViewportInputMode,
  ViewportRect,
} from "@silvery/ag/viewport-types"

type IBufferCell = import("@xterm/headless").IBufferCell

const { Terminal } = xtermPkg

type XTerminal = InstanceType<typeof Terminal>

/** Minimal PTY-child shape — duck-typed so the adapter doesn't depend on a specific spawn library. */
export interface XtermAdapterChild {
  stdout: {
    on(event: "data", listener: (chunk: Buffer | Uint8Array | string) => void): unknown
    off?(event: "data", listener: (chunk: Buffer | Uint8Array | string) => void): unknown
  }
  stdin?: {
    write(chunk: Uint8Array | string): unknown
  }
}

/** Options accepted by {@link XtermAdapter}. */
export interface XtermAdapterOptions {
  cols: number
  rows: number
  /**
   * Optional PTY child. When supplied, the adapter pipes `child.stdout` into
   * the embedded xterm Terminal and forwards xterm's `onData` events to
   * `child.stdin` whenever `captureInput` is `"keys"` or `"all"`.
   */
  child?: XtermAdapterChild
  /**
   * Input mode the source declares to the parent on `connect()`. Default:
   * `"none"` (the source observes — replay frames, snapshots). Pass
   * `"all"` for an interactive PTY mirror.
   */
  captureInput?: ViewportInputMode
  /** Scrollback rows kept by the embedded Terminal. Default: 0 (overlay-style use). */
  scrollback?: number
}

/**
 * A {@link ForeignSource} extended with adapter-specific introspection.
 *
 * Apps that mirror a PTY child wire it via `opts.child`; tests and headless
 * fixtures push bytes through `feedAnsi()` instead.
 */
export interface XtermAdapterHandle extends ForeignSource {
  /** Feed raw ANSI bytes directly into the embedded xterm Terminal. */
  feedAnsi(chunk: Uint8Array | string): void
  /** Input mode requested at construction time (or via {@link setInputMode}). */
  readonly inputMode: ViewportInputMode
  /** Update the input mode; re-calls `ctx.requestInputMode()` if currently connected. */
  setInputMode(mode: ViewportInputMode): void
}

/** Hex string for a 0xRRGGBB integer (matches silvery's `string | null` Cell color shape). */
function rgbHex(value: number): string {
  return "#" + value.toString(16).padStart(6, "0")
}

const ANSI_16_HEX: readonly string[] = [
  "#000000",
  "#800000",
  "#008000",
  "#808000",
  "#000080",
  "#800080",
  "#008080",
  "#c0c0c0",
  "#808080",
  "#ff0000",
  "#00ff00",
  "#ffff00",
  "#0000ff",
  "#ff00ff",
  "#00ffff",
  "#ffffff",
]

function buildPalette256(): string[] {
  const palette: string[] = [...ANSI_16_HEX]
  const levels = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff]
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        const v = (levels[r]! << 16) | (levels[g]! << 8) | levels[b]!
        palette.push(rgbHex(v))
      }
    }
  }
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10
    palette.push(rgbHex((v << 16) | (v << 8) | v))
  }
  return palette
}

const PALETTE_256: readonly string[] = buildPalette256()

const BLANK_CELL: Cell = { char: " ", fg: null, bg: null, attrs: {}, wide: false, continuation: false }

/** Convert an xterm IBufferCell into a silvery Cell. */
function convertCell(c: IBufferCell | undefined): Cell {
  if (!c) return BLANK_CELL

  const width = c.getWidth()
  // xterm continuation cells (width 0) carry the chars of the wide cell to
  // their left; silvery represents them as a slot with `continuation: true`.
  const continuation = width === 0
  const wide = width === 2

  let fg: string | null = null
  if (c.isFgRGB()) fg = rgbHex(c.getFgColor())
  else if (c.isFgPalette()) fg = PALETTE_256[c.getFgColor()] ?? null

  let bg: string | null = null
  if (c.isBgRGB()) bg = rgbHex(c.getBgColor())
  else if (c.isBgPalette()) bg = PALETTE_256[c.getBgColor()] ?? null

  const attrs: CellAttrs = {}
  if (c.isBold()) attrs.bold = true
  if (c.isDim()) attrs.dim = true
  if (c.isItalic()) attrs.italic = true
  if (c.isUnderline()) attrs.underline = true
  if (c.isStrikethrough()) attrs.strikethrough = true
  if (c.isInverse()) attrs.inverse = true
  // Note: blink + hidden are tracked in xterm but not in @silvery/ag's
  // CellAttrs (silvery treats them as out of scope for the v1 cell vocab).
  // Drop them at the boundary rather than smuggle private fields through.

  const chars = c.getChars()
  return {
    char: continuation ? "" : chars === "" ? " " : chars,
    fg,
    bg,
    attrs,
    wide,
    continuation,
  }
}

/**
 * Read the current xterm viewport into an immutable {@link CellBuffer}.
 *
 * The snapshot is taken once per blit so the silvery pipeline can read cells
 * during render without racing the xterm parser.
 */
function snapshotBuffer(term: XTerminal): CellBuffer {
  const cols = term.cols
  const rows = term.rows
  const cells: Cell[] = new Array(cols * rows)
  const buf = term.buffer.active
  const baseY = buf.baseY
  for (let row = 0; row < rows; row++) {
    const line = buf.getLine(row + baseY)
    for (let col = 0; col < cols; col++) {
      cells[row * cols + col] = convertCell(line?.getCell(col))
    }
  }
  return {
    cols,
    rows,
    getCell(col: number, row: number): Cell {
      if (col < 0 || col >= cols || row < 0 || row >= rows) return BLANK_CELL
      return cells[row * cols + col]!
    },
  }
}

/**
 * Construct an {@link XtermAdapter} ForeignSource.
 *
 * @example
 *   const adapter = XtermAdapter({ cols: 80, rows: 24, child: pty, captureInput: "all" })
 *   <Viewport cols={80} rows={24} source={adapter} captureInput="all" />
 */
export function XtermAdapter(opts: XtermAdapterOptions): XtermAdapterHandle {
  let term: XTerminal | null = new Terminal({
    cols: opts.cols,
    rows: opts.rows,
    scrollback: opts.scrollback ?? 0,
    allowProposedApi: true,
  })
  term.loadAddon(new Unicode11Addon())
  term.unicode.activeVersion = "11"

  let ctx: ViewportContext | null = null
  let inputMode: ViewportInputMode = opts.captureInput ?? "none"
  const disposables: { dispose(): void }[] = []
  const decoder = new TextDecoder()
  let flushScheduled = false

  // xterm.js `write()` is async — the parser drains on the next microtask.
  // The internal `_writeBuffer.writeSync(...)` path parses immediately, which
  // is required so the snapshot captured inside our microtask flush reflects
  // the bytes we just fed. Same trick the termless backend uses for tests.
  function writeSync(t: XTerminal, data: string): void {
    ;(t as unknown as { _core: { _writeBuffer: { writeSync(d: string): void } } })._core._writeBuffer.writeSync(data)
  }

  const onStdoutData = (chunk: Buffer | Uint8Array | string): void => {
    if (!term) return
    const data = typeof chunk === "string" ? chunk : decoder.decode(chunk)
    writeSync(term, data)
    scheduleFlush()
  }

  function scheduleFlush(): void {
    if (flushScheduled || !term || !ctx) return
    flushScheduled = true
    // Use microtask so a burst of writes coalesces into a single blit.
    queueMicrotask(flush)
  }

  function flush(): void {
    flushScheduled = false
    if (!term || !ctx) return
    const cols = term.cols
    const rows = term.rows
    const snapshot = snapshotBuffer(term)
    const fullRect: ViewportRect = { row: 0, col: 0, width: cols, height: rows }
    ctx.blit([fullRect], snapshot)
    const buf = term.buffer.active
    ctx.setCursor({ row: buf.cursorY, col: buf.cursorX })
  }

  const handle: XtermAdapterHandle = {
    connect(c: ViewportContext): void {
      ctx = c
      if (!term) return

      disposables.push(
        term.onCursorMove(() => {
          if (!term || !ctx) return
          const buf = term.buffer.active
          ctx.setCursor({ row: buf.cursorY, col: buf.cursorX })
        }),
      )
      disposables.push(
        term.onTitleChange((title: string) => {
          ctx?.emitTitle?.(title)
        }),
      )

      opts.child?.stdout.on("data", onStdoutData)

      if (opts.child?.stdin) {
        disposables.push(
          term.onData((data: string) => {
            if (inputMode === "keys" || inputMode === "all") {
              opts.child!.stdin!.write(data)
            }
          }),
        )
      }

      ctx.requestInputMode(inputMode)

      // Initial paint — guarantees the Viewport renders a defined buffer on
      // the first frame, before any PTY bytes arrive.
      scheduleFlush()
    },

    disconnect(): void {
      for (const d of disposables) {
        try {
          d.dispose()
        } catch {
          // Disposable may already be torn down; ignore.
        }
      }
      disposables.length = 0
      opts.child?.stdout.off?.("data", onStdoutData)
      if (term) {
        try {
          term.dispose()
        } catch {
          // Ignore.
        }
        term = null
      }
      ctx = null
    },

    desiredSize(): { cols: number; rows: number } {
      return { cols: opts.cols, rows: opts.rows }
    },

    feedAnsi(chunk: Uint8Array | string): void {
      if (!term) return
      const data = typeof chunk === "string" ? chunk : decoder.decode(chunk)
      writeSync(term, data)
      scheduleFlush()
    },

    get inputMode(): ViewportInputMode {
      return inputMode
    },

    setInputMode(mode: ViewportInputMode): void {
      inputMode = mode
      ctx?.requestInputMode(mode)
    },
  }

  return handle
}
