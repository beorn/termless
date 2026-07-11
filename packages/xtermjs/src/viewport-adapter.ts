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

import type {
  Cell,
  CellAttrs,
  CellBuffer,
  ForeignSource,
  IslandContext,
  IslandGuest,
  IslandHandle,
  IslandInputEvent,
  IslandKeyEvent,
  IslandMouseEvent,
  IslandProtocolModes,
  ViewportContext,
  ViewportInputMode,
  ViewportRect,
} from "./silvery-compat.ts"
import { scanMouseDecsetTracking } from "@termless/core"
import { bufferFromRows, cloneBufferRows, mergeDirtyRows, type DirtyRect } from "../../../src/terminal/dirty-plane.ts"

type IBufferCell = import("@xterm/headless").IBufferCell

const { Terminal } = xtermPkg

type XTerminal = InstanceType<typeof Terminal>
type XtermDataChunk = Buffer | Uint8Array | string

/** Minimal PTY-child shape — duck-typed so the adapter doesn't depend on a specific spawn library. */
export interface XtermGuestChild {
  stdout?: {
    on(event: "data", listener: (chunk: XtermDataChunk) => void): unknown
    off?(event: "data", listener: (chunk: XtermDataChunk) => void): unknown
  }
  stdin?: {
    write(chunk: Uint8Array | string): unknown
  }
  write?(chunk: string): unknown
  resize?(cols: number, rows: number): unknown
  kill?(signal?: string | number): unknown
  close?(): unknown
  exited?: Promise<number | { code?: number; reason?: string }>
  /**
   * Ordered stream-resize channel (20992): resize events delivered at their
   * exact position in the output stream (a remote session journals resizes
   * between output chunks). When present, these are the guest's fold
   * AUTHORITY — the host resize path only forwards requests to the child and
   * the emulator resizes when the event comes back in-stream, so bursts
   * always fold at the width they were produced for.
   */
  onStreamResize?(listener: (size: { cols: number; rows: number }) => void): () => void
}

/** Legacy Viewport adapter child shape. */
export interface XtermAdapterChild extends XtermGuestChild {
  stdout: NonNullable<XtermGuestChild["stdout"]>
}

/** Options accepted by {@link xtermGuest}. */
export interface XtermGuestOptions {
  cols: number
  rows: number
  child?: XtermGuestChild
  /** Scrollback rows kept by the embedded Terminal. Default: 0 (overlay-style use). */
  scrollback?: number
  /**
   * Coalesce output snapshots/notifications for chatty live PTY streams.
   * Default `0` preserves the historical microtask flush. A small non-zero
   * window lets hosts cap island invalidation pressure without dropping bytes.
   */
  outputCoalesceMs?: number
  /** Protocol modes the PTY guest asks the host to enable while focused. */
  modes?: IslandProtocolModes
  /**
   * Preserve the guest's palette INDICES (basic-16 / 256) instead of resolving
   * them to a fixed standard-palette RGB. Default `false` (resolve to RGB —
   * compositing isolation for recording / rec-overlay guests).
   *
   * Set `true` for a LIVE multiplexer pane (silvermux): the index is emitted as
   * `ansi256(N)`, the host re-emits `38;5;N`, and the OUTER terminal renders it
   * with ITS OWN palette — so the guest shell looks identical inside the mux and
   * outside it. Without this, `\x1b[32m` is baked to standard `#008000` and the
   * outer terminal's theme palette is bypassed (the "paler inside silvermux"
   * bug). Truecolor cells have no index and pass through as exact RGB either way.
   * @km/silvery/19426.
   */
  palettePassthrough?: boolean
}

export interface XtermGuestHandle extends IslandHandle {
  /** Feed raw ANSI bytes directly into the embedded xterm Terminal mirror. */
  feedAnsi(chunk: Uint8Array | string): void
  /** Current embedded terminal viewport/scrollback state. */
  getScrollback(): { viewportOffset: number; totalLines: number; screenLines: number }
  /** Scroll the embedded terminal viewport. Negative scrolls toward older scrollback. */
  scrollViewport(delta: number): void
}

interface XtermIslandHandleOptions extends XtermGuestOptions {
  onTitle?: (title: string) => void
  shouldForwardTerminalData?: () => boolean
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

/** Convert an xterm palette index to either a passthrough `ansi256(N)` token
 * (outer terminal owns the palette) or a fixed standard-palette RGB hex. */
function paletteColor(index: number, passthrough: boolean): string | null {
  if (passthrough) return `ansi256(${index})`
  return PALETTE_256[index] ?? null
}

/** Convert an xterm IBufferCell into a silvery Cell. */
function convertCell(c: IBufferCell | undefined, palettePassthrough: boolean): Cell {
  if (!c) return BLANK_CELL

  const width = c.getWidth()
  // xterm continuation cells (width 0) carry the chars of the wide cell to
  // their left; silvery represents them as a slot with `continuation: true`.
  const continuation = width === 0
  const wide = width === 2

  let fg: string | null = null
  if (c.isFgRGB()) fg = rgbHex(c.getFgColor())
  else if (c.isFgPalette()) fg = paletteColor(c.getFgColor(), palettePassthrough)

  let bg: string | null = null
  if (c.isBgRGB()) bg = rgbHex(c.getBgColor())
  else if (c.isBgPalette()) bg = paletteColor(c.getBgColor(), palettePassthrough)

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
function snapshotBuffer(term: XTerminal, palettePassthrough: boolean): CellBuffer {
  const cols = term.cols
  const rows = term.rows
  const cells: Cell[] = new Array(cols * rows)
  const buf = term.buffer.active
  const viewportY = buf.viewportY
  for (let row = 0; row < rows; row++) {
    const line = buf.getLine(row + viewportY)
    for (let col = 0; col < cols; col++) {
      cells[row * cols + col] = convertCell(line?.getCell(col), palettePassthrough)
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

// xterm.js `write()` is async — the parser drains on the next microtask.
// The internal `_writeBuffer.writeSync(...)` path parses immediately, which
// is required so snapshots reflect the bytes just fed. Same trick the
// termless backend uses for tests.
function writeSync(t: XTerminal, data: string): void {
  ;(t as unknown as { _core: { _writeBuffer: { writeSync(d: string): void } } })._core._writeBuffer.writeSync(data)
}

function createXtermTerminal(opts: { cols: number; rows: number; scrollback?: number }): XTerminal {
  const term = new Terminal({
    cols: opts.cols,
    rows: opts.rows,
    scrollback: opts.scrollback ?? 0,
    allowProposedApi: true,
  })
  term.loadAddon(new Unicode11Addon())
  term.unicode.activeVersion = "11"
  return term
}

function defaultXtermGuestModes(): IslandProtocolModes {
  return {
    bracketedPaste: true,
    kittyKeyboard: true,
    // A freshly-spawned guest has NOT enabled mouse reporting. It starts "off"
    // and is updated to the live mode by scanning the child's DECSET output (see
    // `scanMouseDecset`). A plain shell never enables mouse, so a host with
    // mode-aware mouse routing will not feed it mouse events (no ANSI echo) and
    // clicks fall through to the host. Was "any", which made every guest claim
    // it wanted mouse — the root of the shell-input-trap mouse echo (20349).
    mouseTracking: "off",
    focusReporting: true,
  }
}

function createAsyncEventStream(
  add: (listener: (event: IslandInputEvent) => void) => () => void,
): AsyncIterable<IslandInputEvent> {
  return {
    [Symbol.asyncIterator]() {
      const queue: IslandInputEvent[] = []
      let pending: ((result: IteratorResult<IslandInputEvent>) => void) | null = null
      let done = false
      const unsubscribe = add((event) => {
        if (done) return
        if (pending) {
          const resolve = pending
          pending = null
          resolve({ value: event, done: false })
        } else {
          queue.push(event)
        }
      })

      return {
        next(): Promise<IteratorResult<IslandInputEvent>> {
          if (queue.length > 0) return Promise.resolve({ value: queue.shift()!, done: false })
          if (done) return Promise.resolve({ value: undefined, done: true })
          return new Promise((resolve) => {
            pending = resolve
          })
        },
        return(): Promise<IteratorResult<IslandInputEvent>> {
          done = true
          unsubscribe()
          if (pending) {
            const resolve = pending
            pending = null
            resolve({ value: undefined, done: true })
          }
          return Promise.resolve({ value: undefined, done: true })
        },
      }
    },
  }
}

function normalizeExit(result: number | { code?: number; reason?: string }): { code?: number; reason?: string } {
  return typeof result === "number" ? { code: result } : result
}

function createXtermIslandHandle(opts: XtermIslandHandleOptions): XtermGuestHandle {
  let term: XTerminal | null = createXtermTerminal(opts)
  let cols = opts.cols
  let rows = opts.rows
  const palettePassthrough = opts.palettePassthrough ?? false
  let bufferRows = cloneBufferRows(snapshotBuffer(term, palettePassthrough))
  let buffer: CellBuffer = bufferFromRows(bufferRows)
  let disposed = false
  let outputScheduled = false
  let outputTimer: ReturnType<typeof setTimeout> | null = null
  const decoder = new TextDecoder()
  const sizeListeners = new Set<(size: { cols: number; rows: number }) => void>()
  const outputListeners = new Set<() => void>()
  const modeListeners = new Set<(modes: IslandProtocolModes) => void>()
  const keyListeners = new Set<(event: IslandKeyEvent) => void>()
  const mouseListeners = new Set<(event: IslandMouseEvent) => void>()
  const pasteListeners = new Set<(text: string) => void>()
  const inputEventListeners = new Set<(event: IslandInputEvent) => void>()
  const modes = opts.modes ?? defaultXtermGuestModes()
  const disposables: { dispose(): void }[] = []

  // Mouse-mode tracking (20349). The guest must report its REAL mouse-reporting
  // state so a mode-aware host only forwards mouse to it once the child program
  // turns mouse on (DECSET 1000/1002/1003). We scan the child's output for those
  // private-mode set/reset sequences; if `opts.modes` was supplied by the caller
  // we respect that fixed override and skip scanning.
  const trackMouse = opts.modes === undefined
  const mouseModes = { m1000: false, m1002: false, m1003: false }
  function recomputeMouseTracking(): void {
    const next: IslandProtocolModes["mouseTracking"] = mouseModes.m1003
      ? "any"
      : mouseModes.m1002
        ? "drag"
        : mouseModes.m1000
          ? "click"
          : "off"
    if (modes.mouseTracking === next) return
    modes.mouseTracking = next
    for (const listener of modeListeners) listener(modes)
  }
  let resolveExit: ((exit: { code?: number; reason?: string }) => void) | null = null
  const exit = opts.child?.exited
    ? opts.child.exited.then(normalizeExit)
    : new Promise<{ code?: number; reason?: string }>((resolve) => {
        resolveExit = resolve
      })

  function notifySize(): void {
    const size = { cols, rows }
    for (const listener of sizeListeners) listener(size)
  }

  function notifyOutput(): void {
    for (const listener of outputListeners) listener()
  }

  const outputCoalesceMs = Math.max(0, opts.outputCoalesceMs ?? 0)

  function cancelScheduledOutput(): void {
    if (outputTimer !== null) {
      clearTimeout(outputTimer)
      outputTimer = null
    }
    outputScheduled = false
  }

  function flushScheduledOutput(): void {
    outputScheduled = false
    outputTimer = null
    if (!term || disposed) return
    bufferRows = cloneBufferRows(snapshotBuffer(term, palettePassthrough))
    buffer = bufferFromRows(bufferRows)
    notifyOutput()
  }

  function scheduleOutput(): void {
    if (outputScheduled || !term) return
    outputScheduled = true
    if (outputCoalesceMs > 0) {
      outputTimer = setTimeout(flushScheduledOutput, outputCoalesceMs)
      return
    }
    queueMicrotask(flushScheduledOutput)
  }

  function feedAnsi(chunk: Uint8Array | string): void {
    if (!term || disposed) return
    const data = typeof chunk === "string" ? chunk : decoder.decode(chunk)
    scanMouseDecsetTracking(data, trackMouse, mouseModes, recomputeMouseTracking)
    writeSync(term, data)
    scheduleOutput()
  }

  const onStdoutData = (chunk: XtermDataChunk): void => {
    feedAnsi(typeof chunk === "string" ? chunk : chunk instanceof Buffer ? chunk : new Uint8Array(chunk))
  }
  // Stream-resize authority (20992): apply the journaled resize at its stream
  // position. Registered BEFORE the stdout subscription so a child replaying
  // buffered items on first subscribe notifies both channels in order.
  const applyStreamResize = (size: { cols: number; rows: number }): void => {
    if (!term || disposed) return
    if (size.cols === cols && size.rows === rows) return
    term.resize(size.cols, size.rows)
    cols = size.cols
    rows = size.rows
    cancelScheduledOutput()
    bufferRows = cloneBufferRows(snapshotBuffer(term, palettePassthrough))
    buffer = bufferFromRows(bufferRows)
    notifySize()
    notifyOutput()
  }
  const streamResizeAuthority = typeof opts.child?.onStreamResize === "function"
  const unsubscribeStreamResize = opts.child?.onStreamResize?.(applyStreamResize)
  opts.child?.stdout?.on("data", onStdoutData)
  if (opts.onTitle) {
    disposables.push(term.onTitleChange(opts.onTitle))
  }

  function writeToChild(data: string): void {
    if (opts.child?.write) {
      opts.child.write(data)
    } else {
      opts.child?.stdin?.write(data)
    }
  }

  if (opts.child && (opts.child.write || opts.child.stdin)) {
    disposables.push(
      term.onData((data: string) => {
        if (opts.shouldForwardTerminalData?.() ?? true) writeToChild(data)
      }),
    )
  }

  function signalChild(signal: "SIGINT" | "SIGTSTP" | "SIGTERM" | "SIGKILL", fallback: string | null): void {
    if (opts.child?.kill) {
      opts.child.kill(signal)
      return
    }
    if (fallback != null) {
      writeToChild(fallback)
      return
    }
    void opts.child?.close?.()
  }

  function resize(nextCols: number, nextRows: number): void {
    if (!term || disposed) return
    opts.child?.resize?.(nextCols, nextRows)
    // With a stream-resize channel the local rect is only the REQUEST source:
    // the emulator resizes when the child's journaled resize event arrives
    // in-stream, so pending bursts keep folding at their produced width.
    if (streamResizeAuthority) return
    term.resize(nextCols, nextRows)
    cols = nextCols
    rows = nextRows
    cancelScheduledOutput()
    bufferRows = cloneBufferRows(snapshotBuffer(term, palettePassthrough))
    buffer = bufferFromRows(bufferRows)
    notifySize()
    notifyOutput()
  }

  function emitInputEvent(event: IslandInputEvent): void {
    for (const listener of inputEventListeners) listener(event)
  }

  function scrollViewport(delta: number): void {
    if (!term || disposed || delta === 0) return
    term.scrollLines(delta)
    cancelScheduledOutput()
    buffer = snapshotBuffer(term, palettePassthrough)
    notifyOutput()
  }

  function getScrollback(): { viewportOffset: number; totalLines: number; screenLines: number } {
    if (!term || disposed) return { viewportOffset: 0, totalLines: 0, screenLines: rows }
    const active = term.buffer.active
    return {
      viewportOffset: active.viewportY,
      totalLines: active.length,
      screenLines: rows,
    }
  }

  const handle: XtermGuestHandle = {
    size: {
      get cols() {
        return cols
      },
      get rows() {
        return rows
      },
      subscribe(listener) {
        sizeListeners.add(listener)
        return () => sizeListeners.delete(listener)
      },
      requestResize: resize,
    },
    output: {
      get buffer() {
        return buffer
      },
      get cursor() {
        if (!term) return null
        const active = term.buffer.active
        return { row: active.cursorY, col: active.cursorX, style: "block" as const }
      },
      get cursorVisible() {
        return term !== null
      },
      subscribe(listener) {
        outputListeners.add(listener)
        return () => outputListeners.delete(listener)
      },
      writeCells(dirtyRects, nextBuffer) {
        bufferRows = mergeDirtyRows(bufferRows, nextBuffer, dirtyRects as readonly DirtyRect[])
        buffer = bufferFromRows(bufferRows)
        notifyOutput()
      },
      invalidateAll() {
        notifyOutput()
      },
    },
    input: {
      onKey(handler) {
        keyListeners.add(handler)
        return () => keyListeners.delete(handler)
      },
      onMouse(handler) {
        mouseListeners.add(handler)
        return () => mouseListeners.delete(handler)
      },
      onPaste(handler) {
        pasteListeners.add(handler)
        return () => pasteListeners.delete(handler)
      },
      feed(bytes) {
        writeToChild(decoder.decode(bytes))
        emitInputEvent({ kind: "feed", bytes })
      },
      events() {
        return createAsyncEventStream((listener) => {
          inputEventListeners.add(listener)
          return () => inputEventListeners.delete(listener)
        })
      },
      sendEof() {
        writeToChild("\x04")
      },
    },
    modes: {
      get modes() {
        return modes
      },
      subscribe(listener) {
        modeListeners.add(listener)
        return () => modeListeners.delete(listener)
      },
    },
    signals: {
      sendSigint() {
        signalChild("SIGINT", "\x03")
      },
      sendSigtstp() {
        signalChild("SIGTSTP", "\x1a")
      },
      sendSigterm() {
        signalChild("SIGTERM", null)
      },
      sendSigkill() {
        signalChild("SIGKILL", null)
      },
      exit,
    },
    feedAnsi,
    getScrollback,
    scrollViewport,
    dispose() {
      if (disposed) return
      disposed = true
      cancelScheduledOutput()
      opts.child?.stdout?.off?.("data", onStdoutData)
      unsubscribeStreamResize?.()
      for (const disposable of disposables) {
        try {
          disposable.dispose()
        } catch {
          // Ignore.
        }
      }
      disposables.length = 0
      sizeListeners.clear()
      outputListeners.clear()
      modeListeners.clear()
      keyListeners.clear()
      mouseListeners.clear()
      pasteListeners.clear()
      inputEventListeners.clear()
      if (term) {
        try {
          term.dispose()
        } catch {
          // Ignore.
        }
        term = null
      }
      resolveExit?.({ reason: "disposed" })
      resolveExit = null
    },
  }

  return handle
}

export function xtermGuest(opts: XtermGuestOptions): IslandGuest {
  return {
    capabilities: { input: true, modes: true, resize: true },
    init(ctx: IslandContext): Promise<IslandHandle> {
      const handle = createXtermIslandHandle({ ...opts, cols: ctx.cols, rows: ctx.rows })
      ctx.abortSignal.addEventListener("abort", () => void handle.dispose(), { once: true })
      ctx.emit({ type: "ready" })
      return Promise.resolve(handle)
    },
  }
}

/**
 * Construct an {@link XtermAdapter} ForeignSource.
 *
 * @deprecated Use {@link xtermGuest} with silvery `<Island>` instead. This
 * shim shares the same xterm island core during the Viewport migration window.
 *
 * @example
 *   const adapter = XtermAdapter({ cols: 80, rows: 24, child: pty, captureInput: "all" })
 *   <Viewport cols={80} rows={24} source={adapter} captureInput="all" />
 */
export function XtermAdapter(opts: XtermAdapterOptions): XtermAdapterHandle {
  let ctx: ViewportContext | null = null
  let inputMode: ViewportInputMode = opts.captureInput ?? "none"
  let island: XtermGuestHandle | null = createXtermIslandHandle({
    ...opts,
    onTitle: (title) => ctx?.emitTitle?.(title),
    shouldForwardTerminalData: () => inputMode === "keys" || inputMode === "all",
  })
  let unsubscribeOutput: (() => void) | null = null

  function flush(): void {
    if (!island || !ctx) return
    const cols = island.size.cols
    const rows = island.size.rows
    const fullRect: ViewportRect = { row: 0, col: 0, width: cols, height: rows }
    ctx.blit([fullRect], island.output.buffer)
    const cursor = island.output.cursor
    if (cursor) ctx.setCursor({ row: cursor.row, col: cursor.col })
  }

  const handle: XtermAdapterHandle = {
    connect(c: ViewportContext): void {
      ctx = c
      if (!island) return
      unsubscribeOutput = island.output.subscribe(flush)

      ctx.requestInputMode(inputMode)

      // Initial paint — guarantees the Viewport renders a defined buffer on
      // the first frame, before any PTY bytes arrive.
      flush()
    },

    disconnect(): void {
      unsubscribeOutput?.()
      unsubscribeOutput = null
      void island?.dispose()
      island = null
      ctx = null
    },

    desiredSize(): { cols: number; rows: number } {
      return { cols: island?.size.cols ?? opts.cols, rows: island?.size.rows ?? opts.rows }
    },

    feedAnsi(chunk: Uint8Array | string): void {
      island?.feedAnsi(chunk)
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
