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
 *     follow the scroll offset, so a scrolled viewport is composed from
 *     `snapshot().scrollback` + the live grid (see `snapshotBuffer`).
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
   * vterm.js resolves indexed colors to RGB eagerly (its public cell has no
   * index), so this guest recovers the index by reverse-mapping the resolved
   * RGB against the standard 256-color table — exactly reproducing xterm's
   * `ansi256(N)` passthrough for any color that came from an index. A truecolor
   * cell whose RGB coincides with a standard palette entry is the one ambiguous
   * case (mapped to `ansi256`); it is documented in the differential test.
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
        palette.push("#" + v.toString(16).padStart(6, "0"))
      }
    }
  }
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10
    palette.push("#" + ((v << 16) | (v << 8) | v).toString(16).padStart(6, "0"))
  }
  return palette
}

const PALETTE_256: readonly string[] = buildPalette256()

/**
 * Reverse map: standard-palette hex → LOWEST index producing it. Lowest wins so
 * duplicate RGBs (e.g. #000000 at index 0 and cube-index 16) resolve to the
 * canonical basic-16 index — the index an app most likely used.
 */
const HEX_TO_PALETTE_INDEX: ReadonlyMap<string, number> = (() => {
  const m = new Map<string, number>()
  for (let i = 0; i < PALETTE_256.length; i++) {
    if (!m.has(PALETTE_256[i]!)) m.set(PALETTE_256[i]!, i)
  }
  return m
})()

/**
 * Convert a resolved vterm color to a silvery cell color string. In passthrough
 * mode, a color that exactly matches a standard palette entry is emitted as an
 * `ansi256(N)` token (outer terminal owns the palette); everything else is exact
 * RGB hex.
 */
function cellColor(c: CellColor | null, passthrough: boolean): string | null {
  if (c === null) return null
  const hex = rgbHex(c)
  if (passthrough) {
    const index = HEX_TO_PALETTE_INDEX.get(hex)
    if (index !== undefined) return `ansi256(${index})`
  }
  return hex
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
 * Fast path (viewport at bottom): read the live grid row-by-row via `getLine`.
 * Scrolled path: vterm's row accessors ignore the scroll offset, so compose the
 * visible window from `snapshot().scrollback` (older lines) plus the live grid.
 * The visible row `i` maps to absolute buffer line `(S - V) + i`, where `S` is
 * the scrollback length and `V` the bottom-relative offset — identical geometry
 * to xterm's `viewportY`-based read.
 */
function snapshotBuffer(screen: VtermScreen, passthrough: boolean): CellBuffer {
  const cols = screen.cols
  const rows = screen.rows
  const rowsOut: Cell[][] = new Array(rows)
  const v = screen.getViewportOffset()

  if (v <= 0) {
    for (let row = 0; row < rows; row++) rowsOut[row] = convertRow(screen.getLine(row), cols, passthrough)
  } else {
    const snap = screen.snapshot()
    const scrollback = snap.scrollback
    const grid = snap.main.grid
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
    // the live mode by scanning the child's DECSET output (see scanMouseDecset).
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

  // Lazy snapshot: vterm.process() is synchronous, so the grid is current the
  // instant feedAnsi returns; recompute the CellBuffer only when read after a
  // mutation. Notifications are coalesced separately (scheduleOutput).
  let buffer: CellBuffer = snapshotBuffer(screen, palettePassthrough)
  let bufferDirty = false
  function currentBuffer(): CellBuffer {
    if (bufferDirty && screen) {
      buffer = snapshotBuffer(screen, palettePassthrough)
      bufferDirty = false
    }
    return buffer
  }

  const modes = opts.modes ?? defaultVtermGuestModes()
  // Mouse-mode tracking (20349): report the REAL mouse-reporting state so a
  // mode-aware host only forwards mouse once the child turns it on. Scan the
  // child's output for DECSET 1000/1002/1003; a caller-supplied `modes` is a
  // fixed override, so skip scanning then.
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
  const MOUSE_DECSET = /\x1b\[\?([\d;]+)([hl])/g
  function scanMouseDecset(data: string): void {
    if (!trackMouse || !data.includes("\x1b[?")) return
    let changed = false
    MOUSE_DECSET.lastIndex = 0
    for (let m = MOUSE_DECSET.exec(data); m !== null; m = MOUSE_DECSET.exec(data)) {
      const on = m[2] === "h"
      for (const param of m[1]!.split(";")) {
        if (param === "1000") ((mouseModes.m1000 = on), (changed = true))
        else if (param === "1002") ((mouseModes.m1002 = on), (changed = true))
        else if (param === "1003") ((mouseModes.m1003 = on), (changed = true))
      }
    }
    if (changed) recomputeMouseTracking()
  }

  let lastTitle = screen.getTitle()

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
    currentBuffer()
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

  function maybeEmitTitle(): void {
    if (!opts.onTitle || !screen) return
    const title = screen.getTitle()
    if (title !== lastTitle) {
      lastTitle = title
      opts.onTitle(title)
    }
  }

  function feedAnsi(chunk: Uint8Array | string): void {
    if (!screen || disposed) return
    const data = typeof chunk === "string" ? chunk : decoder.decode(chunk)
    scanMouseDecset(data)
    screen.process(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk)
    bufferDirty = true
    maybeEmitTitle()
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
    bufferDirty = true
    cancelScheduledOutput()
    currentBuffer()
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
    bufferDirty = true
    cancelScheduledOutput()
    currentBuffer()
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
    bufferDirty = true
    cancelScheduledOutput()
    currentBuffer()
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
      writeCells(_dirtyRects, nextBuffer) {
        buffer = nextBuffer
        bufferDirty = false
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
        if (bufferDirty) buffer = snapshotBuffer(screen, palettePassthrough)
        bufferDirty = false
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
