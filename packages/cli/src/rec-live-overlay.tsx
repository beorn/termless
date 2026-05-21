/**
 * Live recording overlay — silvery-mounted mirror of the headless
 * terminal's grid inside a centred chrome window on the host.
 *
 * Architecture
 * ────────────
 * - Silvery's <Terminal> component renders the headless terminal's
 *   grid via the same `rowToAnsi`-equivalent encoder the previous
 *   direct-ANSI painter used. Silvery owns alt-screen entry, cursor
 *   positioning (via cursorOffset on <Terminal>), incremental paints,
 *   and resize handling.
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
 * State flow: the handle methods (rerender / setElapsedMs / stop)
 * push values into a small external store; the <Overlay> component
 * subscribes via `useSyncExternalStore` and re-renders. Silvery's
 * convergence loop coalesces multiple bumps into one paint.
 *
 * The public API surface (`RecLiveOverlayOptions`, `RecLiveOverlayHandle`,
 * `startRecLiveOverlay`) is unchanged — record-cmd.ts and any other
 * callers see the same shape.
 */

import React from "react"
import { Box, Terminal as SilveryTerminal, Text, createTerm } from "silvery"
import { run as silveryRun } from "silvery/runtime"
import type { Terminal } from "../../../src/terminal/types.ts"
import { CSI_LEAVE_ALT_SCREEN, CSI_SHOW_CURSOR, SGR_RESET } from "../../../src/render/ansi.ts"
import type { ChromeStyle } from "../../../src/render/chrome.ts"

// ─────────────────────────────────────────────────────────────────────────────
// Public API — preserved 1:1 with the previous direct-ANSI implementation.
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

// ─────────────────────────────────────────────────────────────────────────────
// Chrome — silvery component tree. Replaces ~250 LOC of direct-ANSI border
// drawing with declarative <Box borderStyle="round">.
// ─────────────────────────────────────────────────────────────────────────────

interface ChromePresetTokens {
  borderStyle: "round" | "single" | "none"
  showTitleBar: boolean
  /** macOS-style traffic-light dots at the left of the title bar. */
  showDots: boolean
  /** Windows-style window controls (− □ ×) at the right of the title bar. */
  showControls: boolean
}

function chromeTokens(style: ChromeStyle): ChromePresetTokens {
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

interface OverlayState {
  revision: number
  elapsedMs: number
  blinkTick: number
}

function createOverlayStore(initial: OverlayState): {
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

interface OverlayProps {
  terminal: Terminal
  title: string
  preset: ChromePresetTokens
  store: OverlayStore
}

function Overlay(props: OverlayProps): React.ReactElement {
  const { terminal, title, preset, store } = props

  // useSyncExternalStore — every store.set() bumps re-render through
  // silvery's convergence loop. Multiple bumps in the same React batch
  // coalesce into one paint (silvery's incremental renderer handles
  // the actual diff).
  const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const { revision, elapsedMs, blinkTick } = state

  const blinkOn = blinkTick % 2 === 0
  const elapsedStr = formatElapsed(elapsedMs)

  const statusBar = (
    <Box flexDirection="row">
      <Text color={blinkOn ? "red" : undefined}>{blinkOn ? "●" : " "}</Text>
      <Text>{` REC ${elapsedStr}  `}</Text>
      <Text color="$fg-muted">· Ctrl+D to stop</Text>
    </Box>
  )

  const grid = <SilveryTerminal terminal={terminal} revision={revision} cursor={true} />

  if (preset.borderStyle === "none") {
    return (
      <Box flexDirection="column" justifyContent="center" alignItems="center">
        {statusBar}
        <Box />
        {grid}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" justifyContent="center" alignItems="center">
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
export function startRecLiveOverlay(terminal: Terminal, opts: RecLiveOverlayOptions = {}): RecLiveOverlayHandle {
  const out = opts.out ?? process.stdout
  const chromeStyle: ChromeStyle = opts.chromeStyle ?? "macos"
  const preset = chromeTokens(chromeStyle)
  const title = opts.title ?? ""
  const fps = opts.fps ?? DEFAULT_FPS
  const tickMs = Math.max(16, Math.floor(1000 / fps))

  const hostCols = opts.hostCols ?? (() => out.columns ?? 80)
  const hostRows = opts.hostRows ?? (() => out.rows ?? 24)

  const store = createOverlayStore({
    revision: 0,
    elapsedMs: opts.startElapsedMs ?? 0,
    blinkTick: 0,
  })

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

  // Construct a Term with stdin ownership opted out. The Term still owns
  // stdout (so silvery owns the alt-screen entry / paint / cursor) but
  // the host's stdin → PTY pipe runs unmodified.
  const term = createTerm({
    stdout: out,
    stdin: process.stdin,
    input: false,
  })

  // Mount silvery. `mode: "fullscreen"` enters the alt screen. `input:
  // false` mirrors the createTerm flag and defence-in-depth-gates every
  // probe + cleanup path that would otherwise touch stdin.
  silveryRun(<Overlay terminal={terminal} title={title} preset={preset} store={store} />, term, {
    mode: "fullscreen",
    input: false,
    // Mouse OFF for silvery — the host owns mouse-mode (see above).
    mouse: false,
    // Selection OFF — recordings typically don't want silvery's drag-
    // select interfering with the recorded program's own selection.
    selection: false,
    // Focus reporting OFF — irrelevant for a non-interactive overlay.
    focusReporting: false,
    cols: hostCols(),
    rows: hostRows(),
  })
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

  // FPS-capped paint coalescing: the recording loop calls `rerender()`
  // per PTY byte burst (potentially thousands of times per second). We
  // flip a dirty bit and only bump the store on the next FPS tick.
  // Silvery's incremental renderer collapses identical paints further.
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
      try {
        ;(term as unknown as Disposable)[Symbol.dispose]?.()
      } catch {
        // Best-effort term cleanup.
      }
    },
  }
}
