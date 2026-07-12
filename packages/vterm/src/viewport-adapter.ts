/**
 * vtermGuest — a production `@silvery/ag` island guest backed by vterm.js, a
 * structural mirror of `@termless/xtermjs`'s `xtermGuest`. A host can inject
 * either behind the hab deck's `ShellGuest` seam (ag/packages/hab-deck) — they
 * share the same island handle SHAPE, not a shared import.
 *
 * Lifecycle: silvery calls `init(ctx)` on mount and disposes on abort. Between
 * those, the guest feeds ANSI bytes from the PTY child into a private vterm.js
 * `Screen`, then exposes the post-write grid as a silvery `CellBuffer`. Cursor
 * position/shape/visibility and terminal modes are read live from the screen.
 *
 * Why a second guest: vterm.js is a pure-TypeScript, zero-native-dep emulator
 * with fuller VT/ECMA-48 coverage than `@xterm/headless`. This guest lets the
 * deck's shell pane run on it. Where vterm.js and xterm.js genuinely diverge in
 * cell/cursor semantics, the differential test records it (a conformance-backlog
 * seed) rather than papering over it. See @si/vterm/21016-terminal-runtime.
 *
 * Backing reads (vterm.js public Screen API):
 *   - `getLine(row)` / `getCell(row,col)` read the LIVE grid only — they do NOT
 *     follow the scroll offset AND strip each color's palette-origin index, so a
 *     scrolled viewport OR a palette-passthrough read is composed from
 *     `snapshot()` (scrollback + the index-preserving grid) instead (see
 *     `snapshotBuffer`).
 *   - `scrollViewport(delta)` on vterm uses a bottom-relative offset (positive =
 *     older); this guest's `scrollViewport` mirrors xterm's absolute-top
 *     convention (negative = older) by negating the delta.
 */

import { createVtermScreen, type CellColor, type ScreenCell, type VtermScreen } from "vterm.js"

import type {
  Cell,
  CellAttrs,
  CellBuffer,
  IslandContext,
  IslandGuest,
  IslandHandle,
  IslandInputEvent,
  IslandKeyEvent,
  IslandMouseEvent,
  IslandProtocolModes,
  ViewportCursorStyle,
} from "./silvery-compat.ts"
import { bufferFromRows, cloneBufferRows, mergeDirtyRows, type DirtyRect } from "../../../src/terminal/dirty-plane.ts"

type VtermDataChunk = Buffer | Uint8Array | string

/** Minimal PTY-child shape — duck-typed so the guest doesn't depend on a specific spawn library. */
export interface VtermGuestChild {
  stdout?: {
    on(event: "data", listener: (chunk: VtermDataChunk) => void): unknown
    off?(event: "data", listener: (chunk: VtermDataChunk) => void): unknown
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
   * exact position in the output stream. When present, these are the guest's
   * fold AUTHORITY — the host resize path only forwards requests to the child
   * and the emulator resizes when the event comes back in-stream, so bursts
   * always fold at the width they were produced for.
   */
  onStreamResize?(listener: (size: { cols: number; rows: number }) => void): () => void
}

/** Options accepted by {@link vtermGuest}. */
export interface VtermGuestOptions {
  cols: number
  rows: number
  child?: VtermGuestChild
  /** Scrollback rows kept by the embedded screen. Default: 0 (overlay-style use). */
  scrollback?: number
  /**
   * Coalesce output notifications for chatty live PTY streams. Default `0`
   * flushes on a microtask. A small non-zero window caps island invalidation
   * pressure without dropping bytes (vterm parses every chunk synchronously).
   */
  outputCoalesceMs?: number
  /** Protocol modes the PTY guest asks the host to enable while focused. */
  modes?: IslandProtocolModes
  /**
   * Preserve the guest's palette INDICES (basic-16 / 256) as `ansi256(N)`
   * instead of resolving them to a fixed standard-palette RGB. Default `false`.
   *
   * vterm.js resolves each indexed SGR (`31`, `91`, `38;5;N`, …) to its palette
   * RGB but keeps the ORIGIN index on the resolved color (`CellColor.index`).
   * This guest reads that provenance directly (via the snapshot, which carries
   * the index that `getCell`/`getLine` strip): an indexed color becomes
   * `ansi256(N)` so the outer terminal owns the palette, a color with no index
   * is genuine truecolor and stays RGB. Reading the origin index — rather than
   * reverse-mapping RGB back to a palette slot — is exact even when the RGB
   * coincides with another palette entry, and stays correct across an OSC 4
   * palette mutation (the resolved RGB moves; the origin index does not).
   * @km/silvery/19426.
   */
  palettePassthrough?: boolean
}

export interface VtermGuestHandle extends IslandHandle {
  /** Feed raw ANSI bytes directly into the embedded vterm screen. */
  feedAnsi(chunk: Uint8Array | string): void
  /** Current embedded terminal viewport/scrollback state. */
  getScrollback(): { viewportOffset: number; totalLines: number; screenLines: number }
  /** Scroll the embedded terminal viewport. Negative scrolls toward older scrollback. */
  scrollViewport(delta: number): void
}

interface VtermIslandHandleOptions extends VtermGuestOptions {
  onTitle?: (title: string) => void
}

// ── Color conversion ───────────────────────────────────────────────────

/** Hex string for a vterm CellColor (matches silvery's `string | null` Cell color shape). */
function rgbHex(c: CellColor): string {
  const v = (c.r << 16) | (c.g << 8) | c.b
  return "#" + v.toString(16).padStart(6, "0")
}

/**
 * Convert a resolved vterm color to a silvery cell color string. In passthrough
 * mode a color carrying a palette-origin index (from an indexed SGR: `31`, `91`,
 * `38;5;N`, …) is emitted as an `ansi256(N)` token so the outer terminal owns
 * the palette; a color with no index is genuine truecolor and stays exact RGB
 * hex. The index is vterm's own parse-time provenance (`CellColor.index`), so an
 * OSC 4 palette mutation moves the resolved RGB but not the token — the index
 * survives, and no RGB coincidence can misclassify a truecolor cell.
 */
function cellColor(c: CellColor | null, passthrough: boolean): string | null {
  if (c === null) return null
  if (passthrough && c.index !== undefined) return `ansi256(${c.index})`
  return rgbHex(c)
}

const BLANK_CELL: Cell = { char: " ", fg: null, bg: null, attrs: {}, wide: false, continuation: false }

/**
 * Convert one vterm row to silvery cells. Row-aware because vterm represents a
 * wide char as `{ wide: true }` followed by a spacer cell with `char: ""` — the
 * spacer becomes silvery's `continuation: true` slot (matching xterm's width-0
 * continuation cells). Unwritten/empty non-continuation cells render as a space,
 * matching xterm's `chars === "" ? " "` rule.
 */
function convertRow(row: readonly ScreenCell[], cols: number, passthrough: boolean): Cell[] {
  const out: Cell[] = new Array(cols)
  let prevWide = false
  for (let col = 0; col < cols; col++) {
    const sc = row[col]
    if (!sc) {
      out[col] = BLANK_CELL
      prevWide = false
      continue
    }
    const continuation = prevWide && sc.char === ""
    const attrs: CellAttrs = {}
    if (sc.bold) attrs.bold = true
    if (sc.faint) attrs.dim = true
    if (sc.italic) attrs.italic = true
    if (sc.underline !== "none") {
      attrs.underline = true
      // Single is the implied default (like xterm, which reports only a boolean);
      // fancier styles are vterm-only fidelity, surfaced explicitly.
      if (sc.underline !== "single") attrs.underlineStyle = sc.underline
    }
    if (sc.strikethrough) attrs.strikethrough = true
    if (sc.inverse) attrs.inverse = true
    // overline / blink / hidden and OSC 8 `url` have no slot in silvery's v1 Cell
    // vocab — dropped at the boundary (xterm drops blink/hidden the same way).
    out[col] = {
      char: continuation ? "" : sc.char === "" ? " " : sc.char,
      fg: cellColor(sc.fg, passthrough),
      bg: cellColor(sc.bg, passthrough),
      attrs,
      wide: sc.wide,
      continuation,
    }
    prevWide = sc.wide
  }
  return out
}

/**
 * Read the current viewport into an immutable {@link CellBuffer}.
 *
 * Fast path (non-passthrough): read viewport rows through vterm's absolute-row
 * contract. The accessor strips palette-origin `CellColor.index`, which is fine
 * when colors resolve straight to RGB anyway.
 *
 * Snapshot path (scrolled OR palette passthrough): vterm's row accessors ignore
 * the scroll offset AND drop the origin index, so read the index-preserving
 * {@link VtermScreen.snapshot} instead — passthrough needs the index to emit
 * `ansi256(N)`, scrolling needs the older lines. The visible row `i` maps to
 * absolute buffer line `(S - V) + i`, where `S` is the scrollback length and
 * `V` the bottom-relative offset (0 at the bottom, so `i` reads live grid row
 * `i`) — identical geometry to xterm's `viewportY`-based read. Reads the ACTIVE
 * buffer's grid so an alt-screen app in passthrough mode still sees alt cells.
 */
function snapshotBuffer(screen: VtermScreen, passthrough: boolean): CellBuffer {
  const cols = screen.cols
  const rows = screen.rows
  const rowsOut: Cell[][] = new Array(rows)
  const v = screen.getViewportOffset()

  if (!passthrough) {
    const viewportTop = screen.viewportTop()
    for (let row = 0; row < rows; row++) {
      rowsOut[row] = convertRow(screen.getRowAbsolute(viewportTop + row), cols, passthrough)
    }
  } else {
    const snap = screen.snapshot()
    const scrollback = snap.scrollback
    const grid = snap.activeBuffer === "alt" ? snap.alt.grid : snap.main.grid
    const s = scrollback.length
    for (let i = 0; i < rows; i++) {
      const abs = s - v + i
      const src = abs < 0 ? undefined : abs < s ? scrollback[abs] : grid[abs - s]
      rowsOut[i] = convertRow(src ?? [], cols, passthrough)
    }
  }

  return {
    cols,
    rows,
    getCell(col: number, row: number): Cell {
      if (col < 0 || col >= cols || row < 0 || row >= rows) return BLANK_CELL
      return rowsOut[row]![col] ?? BLANK_CELL
    },
  }
}

// ── Modes ──────────────────────────────────────────────────────────────

function defaultVtermGuestModes(): IslandProtocolModes {
  return {
    bracketedPaste: true,
    kittyKeyboard: true,
    // A freshly-spawned guest has NOT enabled mouse reporting; it is updated to
    // the live mode from vterm's parser-owned mode signal.
    mouseTracking: "off",
    focusReporting: true,
  }
}

function normalizeExit(result: number | { code?: number; reason?: string }): { code?: number; reason?: string } {
  return typeof result === "number" ? { code: result } : result
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

function createVtermIslandHandle(opts: VtermIslandHandleOptions): VtermGuestHandle {
  let cols = opts.cols
  let rows = opts.rows
  const palettePassthrough = opts.palettePassthrough ?? false
  const decoder = new TextDecoder()
  let disposed = false

  const sizeListeners = new Set<(size: { cols: number; rows: number }) => void>()
  const outputListeners = new Set<() => void>()
  const modeListeners = new Set<(modes: IslandProtocolModes) => void>()
  const keyListeners = new Set<(event: IslandKeyEvent) => void>()
  const mouseListeners = new Set<(event: IslandMouseEvent) => void>()
  const pasteListeners = new Set<(text: string) => void>()
  const inputEventListeners = new Set<(event: IslandInputEvent) => void>()

  function writeToChild(data: string): void {
    if (opts.child?.write) {
      opts.child.write(data)
    } else {
      opts.child?.stdin?.write(data)
    }
  }

  let screen: VtermScreen | null = createVtermScreen({
    cols,
    rows,
    scrollbackLimit: opts.scrollback ?? 0,
    // The emulator's own DA1/DA2/DSR/color-query answers go back to the child as
    // if typed — the same round-trip a real terminal performs.
    onResponse: (data: string) => writeToChild(data),
  })

  // Cache the projected viewport and consume vterm's absolute dirty rows. A
  // structural scroll/resize still rebuilds the viewport, while ordinary writes
  // replace only rows the engine marked dirty.
  let bufferRows = cloneBufferRows(snapshotBuffer(screen, palettePassthrough))
  let buffer: CellBuffer = bufferFromRows(bufferRows)
  screen.takeDirty()
  function rebuildBuffer(): void {
    if (!screen) return
    bufferRows = cloneBufferRows(snapshotBuffer(screen, palettePassthrough))
    buffer = bufferFromRows(bufferRows)
  }
  function refreshBuffer(): void {
    if (!screen) return
    const dirty = screen.takeDirty()
    if (
      dirty.rows === "all" ||
      dirty.scrolled !== 0 ||
      palettePassthrough ||
      bufferRows.length !== screen.rows ||
      bufferRows.some((row) => row.length !== screen!.cols)
    ) {
      rebuildBuffer()
      return
    }
    const viewportTop = screen.viewportTop()
    let changed = false
    for (const absoluteRow of dirty.rows) {
      const viewportRow = absoluteRow - viewportTop
      if (viewportRow < 0 || viewportRow >= screen.rows) continue
      bufferRows[viewportRow] = convertRow(screen.getRowAbsolute(absoluteRow), screen.cols, false)
      changed = true
    }
    if (changed) buffer = bufferFromRows(bufferRows)
  }
  function currentBuffer(): CellBuffer {
    refreshBuffer()
    return buffer
  }

  const modes = opts.modes ?? defaultVtermGuestModes()
  // Parser-owned signals retain escape-sequence state across PTY chunk
  // boundaries; a second byte scanner cannot do that correctly.
  const unsubscribeModes = screen.signals.modes$.subscribe((nextModes) => {
    if (opts.modes) return
    const next: IslandProtocolModes["mouseTracking"] =
      nextModes.mouseTrackingMode === 1003
        ? "any"
        : nextModes.mouseTrackingMode === 1002
          ? "drag"
          : nextModes.mouseTrackingMode === 1000
            ? "click"
            : "off"
    if (modes.mouseTracking === next) return
    modes.mouseTracking = next
    for (const listener of modeListeners) listener(modes)
  })
  const unsubscribeTitle = screen.signals.title$.subscribe((title) => opts.onTitle?.(title))

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
  let outputScheduled = false
  let outputTimer: ReturnType<typeof setTimeout> | null = null
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
    if (!screen || disposed) return
    refreshBuffer()
    notifyOutput()
  }
  function scheduleOutput(): void {
    if (outputScheduled || !screen) return
    outputScheduled = true
    if (outputCoalesceMs > 0) {
      outputTimer = setTimeout(flushScheduledOutput, outputCoalesceMs)
      return
    }
    queueMicrotask(flushScheduledOutput)
  }

  function feedAnsi(chunk: Uint8Array | string): void {
    if (!screen || disposed) return
    screen.process(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk)
    scheduleOutput()
  }

  const onStdoutData = (chunk: VtermDataChunk): void => {
    feedAnsi(typeof chunk === "string" ? chunk : chunk instanceof Buffer ? chunk : new Uint8Array(chunk))
  }

  // Stream-resize authority (20992): apply the journaled resize at its stream
  // position. Registered BEFORE the stdout subscription so a child replaying
  // buffered items on first subscribe notifies both channels in order.
  const applyStreamResize = (size: { cols: number; rows: number }): void => {
    if (!screen || disposed) return
    if (size.cols === cols && size.rows === rows) return
    screen.resize(size.cols, size.rows)
    cols = size.cols
    rows = size.rows
    cancelScheduledOutput()
    screen.takeDirty()
    rebuildBuffer()
    notifySize()
    notifyOutput()
  }
  const streamResizeAuthority = typeof opts.child?.onStreamResize === "function"
  const unsubscribeStreamResize = opts.child?.onStreamResize?.(applyStreamResize)
  opts.child?.stdout?.on("data", onStdoutData)

  function resize(nextCols: number, nextRows: number): void {
    if (!screen || disposed) return
    opts.child?.resize?.(nextCols, nextRows)
    // With a stream-resize channel the local rect is only the REQUEST source;
    // the emulator resizes when the child's journaled resize event arrives.
    if (streamResizeAuthority) return
    screen.resize(nextCols, nextRows)
    cols = nextCols
    rows = nextRows
    cancelScheduledOutput()
    screen.takeDirty()
    rebuildBuffer()
    notifySize()
    notifyOutput()
  }

  function emitInputEvent(event: IslandInputEvent): void {
    for (const listener of inputEventListeners) listener(event)
  }

  function scrollViewport(delta: number): void {
    if (!screen || disposed || delta === 0) return
    // vterm's scrollViewport uses a bottom-relative offset (positive = older);
    // this guest mirrors xterm's absolute-top convention (negative = older), so
    // negate to keep `getScrollback().viewportOffset` and scroll direction in
    // lockstep with the xterm guest.
    screen.scrollViewport(-delta)
    cancelScheduledOutput()
    screen.takeDirty()
    rebuildBuffer()
    notifyOutput()
  }

  function getScrollback(): { viewportOffset: number; totalLines: number; screenLines: number } {
    if (!screen || disposed) return { viewportOffset: 0, totalLines: 0, screenLines: rows }
    const scrollbackLength = screen.getScrollbackLength()
    const relative = screen.getViewportOffset()
    // Convert bottom-relative offset → absolute viewport-top row (xterm's
    // `viewportY`): at bottom (relative 0) the top sits at `scrollbackLength`;
    // scrolled up by N it sits at `scrollbackLength - N`.
    return {
      viewportOffset: scrollbackLength - relative,
      totalLines: scrollbackLength + rows,
      screenLines: rows,
    }
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

  function cursorStyle(): ViewportCursorStyle {
    if (!screen) return "block"
    const shape = screen.getCursorShape()
    return shape === "bar" ? "bar" : shape === "underline" ? "underline" : "block"
  }

  const handle: VtermGuestHandle = {
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
        return currentBuffer()
      },
      get cursor() {
        if (!screen) return null
        const pos = screen.getCursorPosition()
        return { row: pos.y, col: pos.x, style: cursorStyle() }
      },
      get cursorVisible() {
        return screen !== null && screen.getCursorVisible()
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
      unsubscribeModes()
      unsubscribeTitle()
      sizeListeners.clear()
      outputListeners.clear()
      modeListeners.clear()
      keyListeners.clear()
      mouseListeners.clear()
      pasteListeners.clear()
      inputEventListeners.clear()
      // Capture the final frame before dropping the screen so a consumer that
      // reads `output.buffer` after the guest exits still sees the last content
      // (the lazy snapshot may not have run if no notify flushed). vterm is a
      // pure emulator — there is nothing external to release.
      if (screen) {
        refreshBuffer()
        screen = null
      }
      resolveExit?.({ reason: "disposed" })
      resolveExit = null
    },
  }

  return handle
}

/**
 * Construct a vterm-backed island guest.
 *
 * @example
 *   const guest = vtermGuest({ cols: 80, rows: 24, child: pty })
 *   <Island guest={guest} cols={80} rows={24} />
 */
export function vtermGuest(opts: VtermGuestOptions): IslandGuest {
  return {
    capabilities: { input: true, modes: true, resize: true },
    init(ctx: IslandContext): Promise<IslandHandle> {
      const handle = createVtermIslandHandle({ ...opts, cols: ctx.cols, rows: ctx.rows })
      ctx.abortSignal.addEventListener("abort", () => void handle.dispose(), { once: true })
      ctx.emit({ type: "ready" })
      return Promise.resolve(handle)
    },
  }
}
