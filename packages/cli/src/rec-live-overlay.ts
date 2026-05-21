/**
 * Live recording overlay — direct ANSI painter for the host terminal.
 *
 * Mirrors a headless {@link Terminal}'s cell grid into a centred, framed
 * window on the host terminal while a recording is in progress. Unlike a
 * silvery-based overlay, this painter never touches stdin — the host's
 * stdin → PTY pipe runs untouched, so keystrokes (incl. Ctrl-D / Ctrl-C)
 * reach the recorded child program unmodified.
 *
 * Architecture
 * ────────────
 * - Enter alt screen + hide cursor on start, restore both on stop.
 * - Per host frame (~30 fps), repaint everything: chrome (status line +
 *   border + title bar) and the grid (re-read from the headless terminal +
 *   serialised via {@link "../../../src/render/ansi.ts".rowToAnsi}).
 * - `rerender()` from the recording loop just sets a "dirty" flag; the
 *   internal paint timer coalesces bursty PTY output into one paint per
 *   frame instead of per byte.
 * - On host terminal resize, recompute the layout and force a full repaint.
 */

import {
  ansiCursorTo,
  CSI_CLEAR_SCREEN,
  CSI_ENTER_ALT_SCREEN,
  CSI_HIDE_CURSOR,
  CSI_LEAVE_ALT_SCREEN,
  CSI_MOUSE_OFF,
  CSI_MOUSE_ON,
  CSI_SHOW_CURSOR,
  rowToAnsi,
  SGR_RESET,
} from "../../../src/render/ansi.ts"
import type { Terminal } from "../../../src/terminal/types.ts"
import type { ChromeStyle } from "../../../src/render/chrome.ts"

// ─────────────────────────────────────────────────────────────────────────────
// Chrome geometry — how many host rows / cols a given style adds around the
// grid. Centralised so the centering math agrees with the paint loop.
// ─────────────────────────────────────────────────────────────────────────────

/** Pixel-accurate chrome dimensions for a given style. */
export interface ChromeMetrics {
  /** Top border + title bar row count (above the grid). */
  topRows: number
  /** Bottom border row count (below the grid). */
  bottomRows: number
  /** Left side column count (left border + inner padding). */
  leftCols: number
  /** Right side column count (right border + inner padding). */
  rightCols: number
  /** Show the host-rendered title bar? */
  showTitleBar: boolean
  /** Show macOS-style traffic-light dots in the title bar? */
  showDots: boolean
  /** Show Windows-style window controls (− □ ×) at the right of the title bar? */
  showControls: boolean
  /** Border style — single chars chosen from each preset. */
  border: {
    tl: string
    tr: string
    bl: string
    br: string
    h: string
    v: string
  } | null
}

/** Resolve {@link ChromeStyle} → {@link ChromeMetrics}. */
export function chromeMetrics(style: ChromeStyle): ChromeMetrics {
  switch (style) {
    case "macos":
      return {
        topRows: 2, // title bar (with dots) + top edge
        bottomRows: 1,
        leftCols: 1,
        rightCols: 1,
        showTitleBar: true,
        showDots: true,
        showControls: false,
        border: { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" },
      }
    case "windows":
      return {
        topRows: 2,
        bottomRows: 1,
        leftCols: 1,
        rightCols: 1,
        showTitleBar: true,
        showDots: false,
        showControls: true,
        border: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" },
      }
    case "none":
    default:
      return {
        topRows: 0,
        bottomRows: 0,
        leftCols: 0,
        rightCols: 0,
        showTitleBar: false,
        showDots: false,
        showControls: false,
        border: null,
      }
  }
}

/** Computed layout for one paint pass. */
export interface FrameLayout {
  hostCols: number
  hostRows: number
  /** 1-based row of the "● REC ..." status line. */
  statusRow: number
  /** 1-based row of the chrome's top border. */
  frameTop: number
  /** 1-based col of the chrome's left edge. */
  frameLeft: number
  /** Width of the chrome window (border included). */
  frameWidth: number
  /** Height of the chrome window (border included). */
  frameHeight: number
  /** 1-based row where the grid's first row lands. */
  gridTop: number
  /** 1-based col where the grid's first column lands. */
  gridLeft: number
  /** Visible columns of the grid (clipped to host). */
  visibleCols: number
  /** Visible rows of the grid (clipped to host). */
  visibleRows: number
}

/**
 * Compute the frame's host-terminal placement.
 *
 * Status line goes one row ABOVE the frame, padded to leave room. If the host
 * is too small to fit the framed grid, the visible region is clipped — the
 * frame still draws but the grid spills off the edge. Never returns negative
 * positions: in the degenerate case, the frame lands at (1, 1).
 */
export function computeLayout(
  hostCols: number,
  hostRows: number,
  gridCols: number,
  gridRows: number,
  metrics: ChromeMetrics,
): FrameLayout {
  const frameWidth = gridCols + metrics.leftCols + metrics.rightCols
  const frameHeight = gridRows + metrics.topRows + metrics.bottomRows
  // 1 row of margin between status line and frame; +1 row for the status itself.
  const statusReserve = 2

  const totalHeight = frameHeight + statusReserve
  const top = Math.max(1, Math.floor((hostRows - totalHeight) / 2) + 1)
  const statusRow = top
  const frameTop = top + statusReserve
  const frameLeft = Math.max(1, Math.floor((hostCols - frameWidth) / 2) + 1)
  const gridTop = frameTop + metrics.topRows
  const gridLeft = frameLeft + metrics.leftCols

  const visibleCols = Math.max(0, Math.min(gridCols, hostCols - (gridLeft - 1)))
  const visibleRows = Math.max(0, Math.min(gridRows, hostRows - (gridTop - 1) - metrics.bottomRows))

  return {
    hostCols,
    hostRows,
    statusRow,
    frameTop,
    frameLeft,
    frameWidth,
    frameHeight,
    gridTop,
    gridLeft,
    visibleCols,
    visibleRows,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Painter
// ─────────────────────────────────────────────────────────────────────────────

/** Options for {@link startRecLiveOverlay}. */
export interface RecLiveOverlayOptions {
  /** Window chrome — same vocabulary as `--live-chrome`. */
  chromeStyle?: ChromeStyle
  /** Title displayed in the chrome bar. */
  title?: string
  /** Output stream — defaults to process.stdout. */
  out?: NodeJS.WriteStream
  /** Read the host's columns. Defaults to `out.columns`. */
  hostCols?: () => number
  /** Read the host's rows. Defaults to `out.rows`. */
  hostRows?: () => number
  /** Frame rate cap. Defaults to 30 fps. */
  fps?: number
  /** Initial elapsed milliseconds — usually 0. */
  startElapsedMs?: number
}

/** Handle returned by {@link startRecLiveOverlay}. */
export interface RecLiveOverlayHandle {
  /** Request the painter to repaint on the next frame tick. */
  rerender(): void
  /** Force an immediate full repaint (e.g. on host resize). */
  repaint(): void
  /** Replace the elapsed-time value shown in the chrome bar. */
  setElapsedMs(ms: number): void
  /** Stop the painter, restore the host terminal, leave alt screen. */
  stop(): void
}

const DEFAULT_FPS = 30

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

/**
 * Mount the live overlay onto a writable stream and start the paint timer.
 *
 * The painter is NON-INTERACTIVE — it writes to `out` but never reads stdin.
 * Callers (record-cmd) own the stdin → PTY routing. The painter survives
 * silvery's absence: this module imports nothing from React or @silvery/*.
 */
export function startRecLiveOverlay(terminal: Terminal, opts: RecLiveOverlayOptions = {}): RecLiveOverlayHandle {
  const out = opts.out ?? process.stdout
  const chromeStyle: ChromeStyle = opts.chromeStyle ?? "macos"
  const metrics = chromeMetrics(chromeStyle)
  const title = opts.title ?? ""
  const fps = opts.fps ?? DEFAULT_FPS
  const tickMs = Math.max(16, Math.floor(1000 / fps))

  const hostCols = opts.hostCols ?? (() => out.columns ?? 80)
  const hostRows = opts.hostRows ?? (() => out.rows ?? 24)

  let elapsedMs = opts.startElapsedMs ?? 0
  let dirty = true
  let stopped = false
  let layout = computeLayout(hostCols(), hostRows(), terminal.cols, terminal.rows, metrics)

  // Enter alt screen + clear + hide cursor. Mouse mode is NOT enabled
  // unconditionally — that turned host trackpad motion into raw SGR bytes
  // that flowed stdin → PTY → typed into non-mouse-aware shells (zsh
  // showed `[<35;120;5M[<35;121;5M...` text). The recording loop snoops
  // PTY output for `\x1b[?1000h/?1002h/?1003h/?1006h/...l` and mirrors
  // exactly the mouse mode the recorded program asked for. See
  // record-cmd.ts onData handler.
  out.write(CSI_ENTER_ALT_SCREEN + CSI_HIDE_CURSOR + CSI_CLEAR_SCREEN)

  function paintChrome(buf: string[]): void {
    const blinkOn = Math.floor(elapsedMs / 500) % 2 === 0
    const dot = blinkOn ? "\x1b[31m●\x1b[0m" : " "
    const status = `${dot} REC ${formatElapsed(elapsedMs)}  \x1b[2m·  Ctrl+D to stop\x1b[0m`
    buf.push(ansiCursorTo(layout.statusRow, layout.frameLeft) + status)

    const b = metrics.border
    if (!b) return

    const innerWidth = layout.frameWidth - 2

    // Top border
    buf.push(ansiCursorTo(layout.frameTop, layout.frameLeft) + b.tl + b.h.repeat(innerWidth) + b.tr)

    // Title-bar row — traffic-light dots on the LEFT (the macOS / Mission
    // Control mental model), title to the RIGHT of the dots, pinned LEFT
    // (no centring) so it reads as "this window is X" instead of floating.
    // Title rendered in bold + bright-white SGR (\x1b[1;97m) — the heaviest
    // weight most terminals honour.
    if (metrics.showTitleBar) {
      const titleRow = layout.frameTop + 1
      const titleSgr = "\x1b[1;97m"

      // Left cluster: dots (macOS) or just leading padding.
      const dotsStr = metrics.showDots ? "\x1b[31m●\x1b[33m ●\x1b[32m ●\x1b[0m" : ""
      const dotsVisibleLen = metrics.showDots ? 5 : 0 // "● ● ●" = 5 cells
      const dotsBlock = metrics.showDots ? ` ${dotsStr}  ` : " "
      const dotsBlockVisibleLen = metrics.showDots ? 1 + dotsVisibleLen + 2 : 1

      // Right cluster: Windows-style window controls "− □ ×" (minimize,
      // maximize, close) — the canonical mental model for Windows users.
      // SGR for close = bright red, the rest default. 7 visible cells:
      // " − □ × " (4 glyphs + 3 spaces).
      const controlsStr = metrics.showControls ? `  \x1b[2m−\x1b[0m  \x1b[2m□\x1b[0m  \x1b[91m×\x1b[0m ` : ""
      const controlsVisibleLen = metrics.showControls ? 9 : 0

      const maxTitleLen = Math.max(0, innerWidth - dotsBlockVisibleLen - controlsVisibleLen - 1)
      const titleText = title.slice(0, maxTitleLen)
      const titleVisible = dotsBlockVisibleLen + titleText.length
      const pad = Math.max(0, innerWidth - titleVisible - controlsVisibleLen)
      const titleLine = `${dotsBlock}${titleSgr}${titleText}\x1b[0m${" ".repeat(pad)}${controlsStr}`
      buf.push(ansiCursorTo(titleRow, layout.frameLeft) + b.v + titleLine + b.v)
    }

    // Bottom border
    const bottomRow = layout.frameTop + layout.frameHeight - 1
    buf.push(ansiCursorTo(bottomRow, layout.frameLeft) + b.bl + b.h.repeat(innerWidth) + b.br)

    // Side borders for every grid row
    for (let r = 0; r < layout.visibleRows; r++) {
      const row = layout.gridTop + r
      buf.push(ansiCursorTo(row, layout.frameLeft) + b.v)
      buf.push(ansiCursorTo(row, layout.frameLeft + layout.frameWidth - 1) + b.v)
    }
  }

  function paintGrid(buf: string[]): void {
    if (layout.visibleCols <= 0 || layout.visibleRows <= 0) return
    const lines = terminal.getLines()
    // Use the trailing `terminal.rows` rows — that's the visible screen.
    const visible = lines.slice(Math.max(0, lines.length - terminal.rows))
    for (let r = 0; r < layout.visibleRows; r++) {
      const cells = visible[r] ?? []
      const ansi = rowToAnsi(cells, layout.visibleCols)
      buf.push(ansiCursorTo(layout.gridTop + r, layout.gridLeft) + ansi)
    }
  }

  /**
   * Park the host cursor inside the mirrored grid at the cell that
   * corresponds to the recorded shell's cursor. Called as the LAST step
   * of every paint (full + chrome-only) so the cursor stays anchored to
   * the shell's input position. Without this, the chrome-only blink/clock
   * repaint would leave the cursor wherever the last chrome emission
   * landed (typically bottom-right) — visible to the user as a cursor
   * that briefly appears in the right cell then jumps off-grid.
   *
   * Out-of-bounds cursors (host too small for the grid, cursor scrolled
   * outside the visible region) get parked in the host's bottom-right
   * + hidden, so any stray glyph emission lands somewhere safe.
   */
  function paintCursor(buf: string[]): void {
    const cursor = terminal.getCursor()
    const cursorVisible = cursor.visible !== false
    if (
      cursorVisible &&
      cursor.x >= 0 &&
      cursor.x < layout.visibleCols &&
      cursor.y >= 0 &&
      cursor.y < layout.visibleRows
    ) {
      buf.push(ansiCursorTo(layout.gridTop + cursor.y, layout.gridLeft + cursor.x) + SGR_RESET + CSI_SHOW_CURSOR)
    } else {
      buf.push(ansiCursorTo(layout.hostRows, layout.hostCols) + SGR_RESET + CSI_HIDE_CURSOR)
    }
  }

  function paint(): void {
    if (stopped) return
    const buf: string[] = [SGR_RESET, CSI_CLEAR_SCREEN]
    paintChrome(buf)
    paintGrid(buf)
    paintCursor(buf)
    out.write(buf.join(""))
    dirty = false
  }

  const tickTimer = setInterval(() => {
    if (stopped) return
    if (dirty) paint()
    // Always refresh chrome each second (for the blinking dot + clock); the
    // grid only refreshes when `rerender()` was called since the last paint.
    else if (Math.floor(Date.now() / 500) % 2 === 0) {
      // Chrome-only repaint for the blink/clock. Reposition the cursor
      // back inside the grid AFTER the chrome emission — otherwise the
      // chrome writes leave the cursor wherever the last border / title
      // text landed, and the user sees the shell cursor jump off-grid
      // every 500ms.
      const buf: string[] = []
      paintChrome(buf)
      paintCursor(buf)
      out.write(buf.join(""))
    }
  }, tickMs)

  function handleResize(): void {
    layout = computeLayout(hostCols(), hostRows(), terminal.cols, terminal.rows, metrics)
    dirty = true
    paint()
  }
  if (out === process.stdout) {
    process.stdout.on("resize", handleResize)
  }

  // First paint.
  paint()

  return {
    rerender() {
      dirty = true
    },
    repaint() {
      paint()
    },
    setElapsedMs(ms: number) {
      elapsedMs = ms
    },
    stop() {
      if (stopped) return
      stopped = true
      clearInterval(tickTimer)
      if (out === process.stdout) {
        process.stdout.removeListener("resize", handleResize)
      }
      // Force-disable mouse mode on stop — the recorded program may have
      // enabled it and exited without disabling (TUI crash, Ctrl-C, etc.),
      // which leaves the host in a state where every trackpad move emits
      // bytes the shell types as text.
      out.write(CSI_MOUSE_OFF + SGR_RESET + CSI_LEAVE_ALT_SCREEN + CSI_SHOW_CURSOR)
    },
  }
}
