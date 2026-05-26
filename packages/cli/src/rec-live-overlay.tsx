/**
 * Live recording overlay — silvery `<Island>` + xtermGuest composition.
 *
 * Architecture
 * ────────────
 * - Silvery's `<Island>` component mounts the PTY mirror inside a bordered
 *   chrome `<Box>`. The Island owns the external cell buffer boundary, so
 *   chrome (status bar, title bar, border) remains normal silvery `<Box>` +
 *   `<Text>` while recorded PTY content stays an opaque guest cell grid.
 * - The xtermGuest (`@termless/xtermjs`) implements the `IslandGuest`
 *   contract. It feeds ANSI bytes into its private xterm.js Terminal, then
 *   exposes the post-write buffer through the Island output owner.
 * - The host process keeps stdin for itself (record-cmd's stdin → PTY
 *   pipe must reach the recorded child unmodified). Silvery is mounted
 *   with `{ input: false }` so it never grabs stdin — see
 *   `vendor/silvery/docs/design/terminal-component.md` § "render({
 *   input: false })".
 * - Mouse-mode SGR toggle is the recorder's responsibility, NOT
 *   silvery's. Specifically: `record-cmd.ts` snoops the PTY's output
 *   for `\x1b[?1000h/?1002h/?1003h/?1006h/...l` and mirrors exactly the
 *   modes the recorded program asks for to the HOST terminal. Silvery
 *   is mounted with `mouse: false` so it doesn't try to own mouse mode,
 *   and the overlay does NOT add a blanket `CSI_MOUSE_ON` (which would
 *   leak SGR mouse bytes into non-mouse-aware shells — the bug upstream
 *   `8d293a5` fixed).
 *
 * State flow: the handle methods (feed / rerender / setElapsedMs / stop)
 * push values into a small external store; the <Overlay> component
 * subscribes via `useSyncExternalStore` and re-renders. xtermGuest's
 * microtask flush coalesces multiple feed bursts into one paint cycle.
 *
 * The public API surface (`RecLiveOverlayOptions`, `RecLiveOverlayHandle`,
 * `startRecLiveOverlay`) has changed shape this commit: it now takes
 * `cols`/`rows` instead of a `Terminal` argument, and the handle exposes
 * a `feed(data)` method that record-cmd calls per PTY data burst. See
 * `@km/silvery/15739-viewport-rec-rewire-integration` for the rationale.
 *
 * Phase B2 of `@km/silvery/15731-surface-nested-composition-primitive`.
 */

import React from "react"
import { Box, Island, Text, type IslandGuest } from "silvery"
import { run as silveryRun, type RunOptions } from "silvery/runtime"
import { xtermGuest, type XtermGuestChild } from "@termless/xtermjs"
import { CSI_LEAVE_ALT_SCREEN, CSI_SHOW_CURSOR, SGR_RESET } from "../../../src/render/ansi.ts"
import type { ChromeStyle } from "../../../src/render/chrome.ts"

// ─────────────────────────────────────────────────────────────────────────────
// Public API
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
  /**
   * Recorded grid columns — defaults to {@link DEFAULT_GRID_COLS} (80).
   * record-cmd passes its derived grid size (after `clampGridToHost`).
   */
  cols?: number
  /**
   * Recorded grid rows — defaults to {@link DEFAULT_GRID_ROWS} (30).
   * record-cmd passes its derived grid size (after `clampGridToHost`).
   */
  rows?: number
  /** Frame rate cap. Defaults to 30 fps. */
  fps?: number
  /** Initial elapsed milliseconds — usually 0. */
  startElapsedMs?: number
}

/** Handle returned by {@link startRecLiveOverlay}. */
export interface RecLiveOverlayHandle {
  /**
   * Feed PTY bytes (raw or decoded text) into the embedded xtermGuest
   * so the Island's cell buffer reflects the recorded program's latest
   * output. record-cmd calls this from its `onData` callback alongside
   * `headlessTerminal.feed(text)` — the two consumers (asciicast/image
   * capture via headlessTerminal vs live overlay via xtermGuest) are peers
   * on the same byte stream, not chained subscribers.
   */
  feed(data: Uint8Array | string): void
  /**
   * Request the painter to repaint on the next frame tick. Historically
   * record-cmd called this after writing to the headless terminal. Since
   * `feed()` already bumps the revision counter (which the React tree
   * picks up via useSyncExternalStore), this is a no-op alias kept for
   * API-shape stability with the pre-Island version.
   */
  rerender(): void
  /** Force an immediate full repaint (e.g. on host resize). */
  repaint(): void
  /** Replace the elapsed-time value shown in the chrome bar. */
  setElapsedMs(ms: number): void
  /** Stop the painter, restore the host terminal, leave alt screen. */
  stop(): void
}

type RecorderOverlayRunOptions = RunOptions & {
  /**
   * Runtime-supported by silvery createApp; not exposed on every supported
   * silvery RunOptions type yet.
   */
  guardOutput?: boolean
}

const DEFAULT_FPS = 30

/**
 * Minimum recorded-grid size. Below this the recorded app is unusable; if
 * the host viewport can't fit even this plus chrome, the overlay clamps the
 * grid to the floor and accepts that the grid is wider than the host (the
 * recorded app then scrolls/clips rather than the host wrapping host text).
 */
export const MIN_GRID_COLS = 20
export const MIN_GRID_ROWS = 6

/**
 * Recorded-grid default size — the user-decided fixed README-fit dimensions.
 *
 * The live overlay sizes the recorded child PTY at these defaults regardless
 * of host width/height, then LETTERBOXES the chrome box inside the host
 * viewport. The host owns the surface (paints every cell every frame via
 * `Overlay` root with `backgroundColor=$bg` + `width/height 100%`), so the
 * letterbox margin around the recorded box never bleeds host scrollback.
 *
 * When the host is narrower/shorter than `DEFAULT_GRID + chromeOverhead`,
 * the grid clamps DOWN (never up — host width never grows the grid). This
 * is the "clamp-down only" rule from `clampGridToHost` below.
 *
 * These values must stay aligned with the `--cols/--rows` flag defaults in
 * `record-cmd.ts` (the artifact-capture size, which historically and now
 * shares the same 80×30 README-fit default). Both should be 80×30.
 */
export const DEFAULT_GRID_COLS = 80
export const DEFAULT_GRID_ROWS = 30

/**
 * Chrome overhead — the cells the overlay's silvery component tree consumes
 * AROUND the recorded grid, per chrome style. This is the single source of
 * truth for the size contract: the recorded child PTY (and the xtermGuest
 * mirroring it) MUST be sized to `host − chromeOverhead` so the Island
 * grid always fits the viewport that displays it. Sizing the recorded child
 * independently of this is the root cause of `@km/termless/15589`
 * (host-scrollback bleed + recorded-app line-wrap).
 *
 * Layout (see {@link Overlay}):
 * - status bar:  1 row
 * - spacer box:  1 row
 * - bordered box: top+bottom border = 2 rows, left+right border = 2 cols
 * - title bar (macos/windows only): 1 row
 *
 * `none` chrome draws no border and no title bar — only the status bar +
 * spacer cost rows.
 */
export interface ChromeOverhead {
  cols: number
  rows: number
}

export function chromeOverhead(style: ChromeStyle): ChromeOverhead {
  switch (style) {
    case "macos":
    case "windows":
      // 2 cols border; 1 status + 1 spacer + 2 border + 1 titlebar rows.
      return { cols: 2, rows: 5 }
    case "none":
    default:
      // No border, no titlebar — just the status bar + spacer.
      return { cols: 0, rows: 2 }
  }
}

/**
 * Resolve the EFFECTIVE chrome style for a given host viewport.
 *
 * When the host is too small to fit `MIN_GRID + chromeOverhead(style)`, the
 * bordered chrome would force the grid below its usable floor (or, worse,
 * overflow the host and reintroduce `@km/termless/15589`). In that case we
 * downgrade to `none` chrome — it has the least overhead (no border, no
 * title bar), so the recorded grid still fits. This is the
 * "auto-drop chrome when too small" guardrail: the recording stays clean on
 * a narrow terminal instead of crashing or bleeding.
 *
 * `none` is already minimal — it never downgrades further.
 */
export function resolveLiveChrome(hostCols: number, hostRows: number, requested: ChromeStyle): ChromeStyle {
  if (requested === "none") return "none"
  const overhead = chromeOverhead(requested)
  const fitsWidth = hostCols - overhead.cols >= MIN_GRID_COLS
  const fitsHeight = hostRows - overhead.rows >= MIN_GRID_ROWS
  return fitsWidth && fitsHeight ? requested : "none"
}

/**
 * Derive the recorded-grid size from the host viewport and chrome style.
 *
 * **Clamp-down rule (15614, user-decided)**: the recorded grid is the
 * `DEFAULT_GRID` default size (80×30) UNLESS the host viewport minus chrome
 * cannot fit it — in which case the grid clamps DOWN to fit the host. The
 * grid NEVER GROWS to fill a wider host. The chrome box is then LETTERBOXED
 * inside the host viewport (centered by silvery's `<Box>` layout); the
 * overlay root paints every host cell so the letterbox margin can never
 * bleed host scrollback.
 *
 *   - host ≥ DEFAULT_GRID + chromeOverhead → grid = DEFAULT_GRID (letterbox)
 *   - host < DEFAULT_GRID + chromeOverhead → grid = max(MIN_GRID, host - chromeOverhead)
 *
 * Pure function — no silvery, no xtermGuest, no TTY. Same semantics as
 * the pre-Island version; the contract is independent of which component
 * renders the grid.
 */
export function clampGridToHost(
  hostCols: number,
  hostRows: number,
  style: ChromeStyle,
): { cols: number; rows: number } {
  const overhead = chromeOverhead(style)
  // host − chrome is the largest the grid could ever be at this host size.
  // The default cap (80×30) caps it FROM ABOVE; the min-grid floor caps it
  // FROM BELOW. Result: grid ≤ DEFAULT and grid ≤ host − chrome.
  const availableCols = hostCols - overhead.cols
  const availableRows = hostRows - overhead.rows
  return {
    cols: Math.max(MIN_GRID_COLS, Math.min(DEFAULT_GRID_COLS, availableCols)),
    rows: Math.max(MIN_GRID_ROWS, Math.min(DEFAULT_GRID_ROWS, availableRows)),
  }
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Chrome — silvery component tree.
// ─────────────────────────────────────────────────────────────────────────────

export interface ChromePresetTokens {
  borderStyle: "round" | "single" | "none"
  showTitleBar: boolean
  /** macOS-style traffic-light dots at the left of the title bar. */
  showDots: boolean
  /** Windows-style window controls (− □ ×) at the right of the title bar. */
  showControls: boolean
}

export function chromeTokens(style: ChromeStyle): ChromePresetTokens {
  switch (style) {
    case "macos":
      return { borderStyle: "round", showTitleBar: true, showDots: true, showControls: false }
    case "windows":
      return { borderStyle: "single", showTitleBar: true, showDots: false, showControls: true }
    case "none":
    default:
      return { borderStyle: "none", showTitleBar: false, showDots: false, showControls: false }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// External store — the imperative handle drives state changes; the React
// tree subscribes via useSyncExternalStore. One bump fans out to all reads.
// ─────────────────────────────────────────────────────────────────────────────

export interface OverlayState {
  revision: number
  elapsedMs: number
  blinkTick: number
}

export function createOverlayStore(initial: OverlayState): {
  getSnapshot(): OverlayState
  subscribe(listener: () => void): () => void
  set(updates: Partial<OverlayState>): void
} {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(updates: Partial<OverlayState>) {
      state = { ...state, ...updates }
      for (const l of listeners) l()
    },
  }
}

type OverlayStore = ReturnType<typeof createOverlayStore>

/**
 * Props for {@link Overlay}. Exported alongside the component so tests
 * (and future regression checks for `@km/termless/15589`) can render it
 * through `@silvery/test`'s `createRenderer` and assert the surface-
 * ownership + no-overflow contract without spinning up a real PTY.
 */
export interface OverlayProps {
  guest: IslandGuest
  cols: number
  rows: number
  title: string
  preset: ChromePresetTokens
  store: OverlayStore
}

/**
 * The live-overlay React tree — status bar + spacer + (optionally bordered)
 * recorded grid via `<Island>`, centred on a full-surface background
 * that the overlay OWNS. Exported for tests; production code reaches it
 * via {@link startRecLiveOverlay}.
 */
export function Overlay(props: OverlayProps): React.ReactElement {
  const { guest, cols, rows, title, preset, store } = props

  // useSyncExternalStore — every store.set() bumps re-render through
  // silvery's convergence loop. Multiple bumps in the same React batch
  // coalesce into one paint (silvery's incremental renderer handles
  // the actual diff). xtermGuest's own microtask flush coalesces island
  // output-buffer dirty bits separately.
  const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const { elapsedMs, blinkTick } = state

  const blinkOn = blinkTick % 2 === 0
  const elapsedStr = formatElapsed(elapsedMs)

  const statusBar = (
    <Box flexDirection="row">
      <Text color={blinkOn ? "red" : undefined}>{blinkOn ? "●" : " "}</Text>
      <Text>{` REC ${elapsedStr}  `}</Text>
      <Text color="$fg-muted">· Ctrl+D to stop</Text>
    </Box>
  )

  // Island replaces the previous <Viewport source={XtermAdapter}> shim. The
  // bg-coherence violation that bead @km/silvery/15506 patchworked (chalk bg
  // color from the recorded program vs silvery's bufferBg) is structurally
  // impossible across the Island boundary. The overlay is non-interactive:
  // record-cmd owns stdin → PTY pipe, so per-island input/modes are narrowed
  // off even though xtermGuest supports them for interactive uses.
  const grid = (
    <Island guest={guest} cols={cols} rows={rows} focusable={false} capabilities={{ input: false, modes: false }} />
  )

  // The root box MUST own the full host surface. `width="100%" height="100%"`
  // sizes it to the silvery viewport (= host terminal); `backgroundColor`
  // makes the overlay tree paint EVERY cell — including the margin around the
  // centered chrome box — on every frame. Without this the incremental
  // renderer leaves the margin cells untouched after the one-time alt-screen
  // clear, and any pre-existing host-screen content shows through. This is
  // the host-scrollback-bleed half of `@km/termless/15589`.
  const rootProps = {
    flexDirection: "column" as const,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    width: "100%" as const,
    height: "100%" as const,
    backgroundColor: "$bg",
  }

  if (preset.borderStyle === "none") {
    return (
      <Box {...rootProps}>
        {statusBar}
        <Box />
        {grid}
      </Box>
    )
  }

  return (
    <Box {...rootProps}>
      {statusBar}
      <Box />
      <Box borderStyle={preset.borderStyle} flexDirection="column">
        {preset.showTitleBar && (
          <Box flexDirection="row" paddingX={1}>
            {preset.showDots && (
              <>
                <Text color="red">●</Text>
                <Text> </Text>
                <Text color="yellow">●</Text>
                <Text> </Text>
                <Text color="green">●</Text>
                <Text>{"  "}</Text>
                <Text color="$fg-muted">·</Text>
                <Text>{"  "}</Text>
              </>
            )}
            <Text bold>{title}</Text>
            {preset.showControls && (
              <>
                <Box flexGrow={1} />
                <Text color="$fg-muted">−</Text>
                <Text>{"  "}</Text>
                <Text color="$fg-muted">□</Text>
                <Text>{"  "}</Text>
                <Text color="red">×</Text>
              </>
            )}
          </Box>
        )}
        {grid}
      </Box>
    </Box>
  )
}

interface BufferedXtermGuest {
  guest: IslandGuest
  feed(data: Uint8Array | string): void
}

type XtermStdoutListener = Parameters<NonNullable<XtermGuestChild["stdout"]>["on"]>[1]

function createBufferedXtermGuest(cols: number, rows: number): BufferedXtermGuest {
  const listeners = new Set<XtermStdoutListener>()
  const pending: Array<Uint8Array | string> = []
  const child: XtermGuestChild = {
    stdout: {
      on(event, listener) {
        if (event !== "data") return undefined
        listeners.add(listener)
        const backlog = pending.splice(0)
        for (const chunk of backlog) listener(chunk)
        return undefined
      },
      off(event, listener) {
        if (event === "data") listeners.delete(listener)
        return undefined
      },
    },
  }

  return {
    guest: xtermGuest({ cols, rows, child, modes: {} }),
    feed(data) {
      if (listeners.size === 0) {
        pending.push(data)
        return
      }
      for (const listener of listeners) listener(data)
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mount the live overlay onto a writable stream and start the paint timer.
 *
 * The overlay is NON-INTERACTIVE — silvery is mounted with `input: false`
 * so it never reads stdin. Callers (record-cmd) own the stdin → PTY
 * routing; keystrokes (Ctrl-D / Ctrl-C / typing / mouse bytes) reach the
 * recorded child unmodified.
 */
export function startRecLiveOverlay(opts: RecLiveOverlayOptions = {}): RecLiveOverlayHandle {
  const out = opts.out ?? process.stdout
  const chromeStyle: ChromeStyle = opts.chromeStyle ?? "macos"
  const preset = chromeTokens(chromeStyle)
  const title = opts.title ?? ""
  const fps = opts.fps ?? DEFAULT_FPS
  const tickMs = Math.max(16, Math.floor(1000 / fps))

  const cols = opts.cols ?? DEFAULT_GRID_COLS
  const rows = opts.rows ?? DEFAULT_GRID_ROWS

  const hostCols = opts.hostCols ?? (() => out.columns ?? 80)
  const hostRows = opts.hostRows ?? (() => out.rows ?? 24)

  const store = createOverlayStore({
    revision: 0,
    elapsedMs: opts.startElapsedMs ?? 0,
    blinkTick: 0,
  })

  // xtermGuest wraps @xterm/headless inside the @silvery/ag IslandGuest
  // lifecycle. record-cmd calls `handle.feed(data)` for each PTY byte burst;
  // the buffered child stdout shape lets the guest subscribe when its Island
  // lifecycle starts without losing early PTY bytes.
  const overlayGuest = createBufferedXtermGuest(cols, rows)

  let stopped = false
  let pendingRerender = false
  let appHandle: { unmount(): void } | null = null

  // Host mouse-mode is NOT enabled unconditionally — that would turn
  // trackpad motion into raw SGR bytes flowing through stdin → PTY → a
  // non-mouse-aware shell as visible text. Instead, `record-cmd.ts`
  // snoops PTY output for `\x1b[?1000h/?1002h/?1003h/?1006h/...l` and
  // mirrors exactly the mouse mode the recorded program asks for. Our
  // job here is just NOT to fight that — silvery's `input: false`
  // means it doesn't own host mouse mode, so the snooper's emissions
  // land on the host terminal directly.

  // Mount silvery. `mode: "fullscreen"` enters the alt screen. `input:
  // false` defence-in-depth-gates every probe + cleanup path that would
  // otherwise touch stdin.
  const runOptions: RecorderOverlayRunOptions = {
    mode: "fullscreen",
    stdout: out,
    stdin: process.stdin,
    input: false,
    // Mouse OFF for silvery — the host owns mouse-mode (see above).
    mouse: false,
    // Selection OFF — recordings typically don't want silvery's drag-
    // select interfering with the recorded program's own selection.
    selection: false,
    // Focus reporting OFF — irrelevant for a non-interactive overlay.
    focusReporting: false,
    // The recorder is itself the host process. Silvery's output guard is
    // useful for normal apps, but here its activation/deactivation logs and
    // buffered replay become visible recorder noise after Ctrl-D.
    guardOutput: false,
    cols: hostCols(),
    rows: hostRows(),
  }

  silveryRun(
    <Overlay guest={overlayGuest.guest} cols={cols} rows={rows} title={title} preset={preset} store={store} />,
    runOptions,
  )
    .then((handle) => {
      appHandle = handle
    })
    .catch((err) => {
      // Silvery render failures must not crash the recording. Log to
      // stderr so the user sees what went wrong, but keep the recording
      // alive — the asciicast captures fine without the overlay.
      try {
        process.stderr.write(`[rec-live-overlay] silvery render failed: ${String(err)}\n`)
      } catch {
        /* terminal may be gone */
      }
    })

  // FPS-capped paint coalescing: feed() flips a dirty bit and only bumps
  // the store on the next FPS tick. Silvery's incremental renderer
  // collapses identical paints further; xtermGuest's own microtask flush
  // coalesces island-buffer dirty bits separately.
  const tickTimer = setInterval(() => {
    if (stopped) return
    if (!pendingRerender) return
    pendingRerender = false
    store.set({ revision: store.getSnapshot().revision + 1 })
  }, tickMs)

  // Blink/clock — half-second cadence, independent of grid revisions.
  // We bump `blinkTick` rather than poking React directly so the
  // overlay's useSyncExternalStore picks up the change.
  const blinkTimer = setInterval(() => {
    if (stopped) return
    store.set({ blinkTick: store.getSnapshot().blinkTick + 1 })
  }, 500)

  // Host resize — silvery's Size owner subscribes to the same
  // process.stdout `resize` event we'd subscribe to, so the React
  // tree's layout reflows automatically. We don't need a manual
  // resize listener here.
  // (Read hostCols/hostRows to satisfy lint — they're available for
  // callers that pass custom getters but not needed at runtime.)
  void hostCols
  void hostRows

  return {
    feed(data: Uint8Array | string) {
      if (stopped) return
      overlayGuest.feed(data)
      pendingRerender = true
    },
    rerender() {
      pendingRerender = true
    },
    repaint() {
      pendingRerender = true
    },
    setElapsedMs(ms: number) {
      store.set({ elapsedMs: ms })
      // The blink + clock interval picks up the new elapsedMs on its
      // own; forcing an extra tick here would defeat the FPS cap.
    },
    stop() {
      if (stopped) return
      stopped = true
      clearInterval(tickTimer)
      clearInterval(blinkTimer)
      try {
        appHandle?.unmount()
        // Silvery's unmount disposes the Island guest lifecycle — no need to
        // reach through to xtermGuest internals here.
      } catch {
        // Best-effort — the alt-screen exit below restores the host
        // regardless.
      }
      // Silvery's unmount restores the alt-screen + cursor. Re-emit the
      // alt-screen leave + cursor-show as a belt-and-braces safety net for
      // the case where silvery's render never resolved. Host mouse mode is
      // NOT touched here — the recorded child program emits its own
      // `\x1b[?1003l` etc. on exit, and record-cmd.ts's snooper mirrors
      // those to the host. Adding a blanket CSI_MOUSE_OFF here would
      // double-disable + race the snooper.
      try {
        out.write(SGR_RESET + CSI_LEAVE_ALT_SCREEN + CSI_SHOW_CURSOR)
      } catch {
        /* terminal may be gone */
      }
    },
  }
}
