/**
 * Live recording overlay — silvery + Viewport composition.
 *
 * Mirrors a headless {@link Terminal}'s cell grid into a centred, framed
 * window on the host terminal while a recording is in progress. The chrome
 * (status bar with "● REC m:ss · Ctrl+D to stop", window-style title bar,
 * border) is painted as a regular silvery tree; the PTY grid lives inside a
 * `<Viewport source={XtermAdapter(...)}>` which structurally bypasses
 * silvery's bg-coherence invariant for the foreign cells.
 *
 * History
 * ───────
 * Before Phase B2 of bead `@km/silvery/15513-surface-nested-composition-primitive`,
 * this module was a direct-ANSI painter that cleared the alt-screen and
 * pushed cursor / SGR bytes every paint tick. That approach worked but
 * collided with silvery's pipeline whenever the chrome itself tried to use
 * silvery for layout. The Viewport primitive lets us delete the bespoke
 * painter without losing the bg-coherence escape hatch the recorded TUI
 * needs.
 *
 * The painter remained NON-INTERACTIVE — silvery owns alt-screen and stdout,
 * but does NOT touch stdin. Keystrokes (Ctrl-D, Ctrl-C, normal typing) reach
 * the recorded child unmodified because we pass `input: false` to `run()`.
 *
 * Architecture
 * ────────────
 * - {@link RecOverlay} React component: outer Box centres a chrome Box +
 *   inside the chrome, a `<Viewport>` shows the PTY grid via XtermAdapter.
 * - {@link startRecLiveOverlay} factory: constructs the adapter, mounts the
 *   component via `silvery/runtime.run()`, returns a handle with feed +
 *   rerender + setElapsedMs + stop. record-cmd's PTY onData routes bytes
 *   through `handle.feed(data)` so the adapter sees them.
 * - Chrome geometry helpers (`chromeMetrics`, `computeLayout`) are
 *   preserved verbatim — pure functions, still useful for layout math + GIF
 *   chrome composition downstream.
 */

import React, { useEffect, useMemo, useState } from "react"
import { Box, Text, Viewport } from "silvery"
import { run } from "silvery/runtime"
import { XtermAdapter, type XtermAdapterHandle } from "@termless/xtermjs"

import type { Terminal } from "../../../src/terminal/types.ts"
import type { ChromeStyle } from "../../../src/render/chrome.ts"
import { chromeMetrics, computeLayout, type ChromeMetrics, type FrameLayout } from "./rec-overlay-geometry.ts"

// Re-export the pure-geometry surface so callers can keep their existing
// import path. Downstream code that ONLY needs the math (tests, GIF chrome
// encoder) should import directly from `./rec-overlay-geometry.ts` to avoid
// pulling in silvery.
export { chromeMetrics, computeLayout }
export type { ChromeMetrics, FrameLayout }

// ─────────────────────────────────────────────────────────────────────────────
// Options + handle
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
  /** Initial elapsed milliseconds — usually 0. */
  startElapsedMs?: number
}

/** Handle returned by {@link startRecLiveOverlay}. */
export interface RecLiveOverlayHandle {
  /**
   * Feed PTY bytes (raw or decoded text) into the embedded XtermAdapter so the
   * Viewport's cell buffer reflects the recorded program's latest output.
   *
   * The headless Terminal doesn't expose a write subscription API — record-cmd's
   * PTY onData callback already calls `headlessTerminal.feed(data)` AND
   * `liveView.feed(data)`. The two consumers (GIF capture + live overlay) are
   * peers on the same byte stream rather than chained subscribers.
   */
  feed(data: Uint8Array | string): void
  /**
   * Backward-compat alias — historical record-cmd code paths call `rerender()`
   * after writing to the headless terminal. Since the silvery pipeline already
   * tracks the Viewport buffer dirty bits via the XtermAdapter's microtask
   * flush, this is a no-op kept for API stability.
   */
  rerender(): void
  /** Force an immediate full repaint (e.g. on host resize). */
  repaint(): void
  /** Replace the elapsed-time value shown in the status bar. */
  setElapsedMs(ms: number): void
  /** Stop the overlay, tear down silvery, restore the host terminal. */
  stop(): Promise<void>
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

// ─────────────────────────────────────────────────────────────────────────────
// React component
// ─────────────────────────────────────────────────────────────────────────────

interface RecOverlayProps {
  adapter: XtermAdapterHandle
  cols: number
  rows: number
  chromeStyle: ChromeStyle
  title: string
  elapsedMs: number
  /**
   * Subscription source for "adapter saw new bytes" events. The component
   * subscribes on mount and bumps an internal state counter so silvery's
   * pipeline re-runs (source-driven blits alone only mark the viewport
   * dirty; without a state change React doesn't re-enter the reconciler).
   */
  subscribeFeed: (listener: () => void) => () => void
  /**
   * Mount a {@link RecOverlayController} into the parent's ref so
   * {@link startRecLiveOverlay} can call setElapsedMs / repaint after mount.
   * The component doesn't expose a forwardRef because it's only consumed
   * from inside this file.
   */
  bindController?: (controller: RecOverlayController) => void
}

interface RecOverlayController {
  setElapsedMs(ms: number): void
  repaint(): void
}

function RecOverlay({ adapter, cols, rows, chromeStyle, title, elapsedMs, subscribeFeed, bindController }: RecOverlayProps): React.JSX.Element {
  const metrics = useMemo(() => chromeMetrics(chromeStyle), [chromeStyle])
  const [localElapsed, setLocalElapsed] = useState(elapsedMs)
  const [, setRepaintTick] = useState(0)

  useEffect(() => {
    if (!bindController) return
    bindController({
      setElapsedMs: (ms) => setLocalElapsed(ms),
      repaint: () => setRepaintTick((t) => t + 1),
    })
  }, [bindController])

  // Subscribe to adapter writes — silvery's render pipeline doesn't observe
  // source-driven dirty marks on its own, so we bump a state counter to
  // schedule a React commit on every feed batch. The XtermAdapter's flush
  // happens on a microtask, so by the time setRepaintTick lands silvery's
  // next paint sees the updated cells.
  useEffect(() => {
    return subscribeFeed(() => {
      setRepaintTick((t) => t + 1)
    })
  }, [subscribeFeed])

  // Blink the red dot once per 500ms — driven off elapsedMs, no extra timer.
  const blinkOn = Math.floor(localElapsed / 500) % 2 === 0
  const dot = blinkOn ? "●" : " "
  const statusText = `${dot} REC ${formatElapsed(localElapsed)}  ·  Ctrl+D to stop`

  // Title bar text — "[dots] title  ...  [controls]"
  const dotsStr = metrics.showDots ? "● ● ●" : ""
  const controlsStr = metrics.showControls ? "−  □  ×" : ""

  // Map ChromeStyle → silvery borderStyle:
  //   macos    → "round"  (╭ ╮ ╰ ╯ — soft corners)
  //   windows  → "single" (┌ ┐ └ ┘ — square corners, Windows convention)
  //   none     → undefined (no border)
  const borderStyle: "round" | "single" | undefined = metrics.border
    ? chromeStyle === "windows"
      ? "single"
      : "round"
    : undefined

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
      <Text>{statusText}</Text>
      <Box flexDirection="column">
        {metrics.showTitleBar ? (
          <Box flexDirection="row">
            {metrics.showDots ? (
              <Text>{` ${dotsStr}  `}</Text>
            ) : (
              <Text> </Text>
            )}
            <Box flexGrow={1}>
              <Text bold>{title}</Text>
            </Box>
            {metrics.showControls ? <Text>{`  ${controlsStr} `}</Text> : null}
          </Box>
        ) : null}
        <Box borderStyle={borderStyle} flexDirection="column">
          <Viewport
            cols={cols}
            rows={rows}
            source={adapter}
            focusable={false}
            captureInput="none"
            cursorVisible
          />
        </Box>
      </Box>
    </Box>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mount the live overlay as a silvery app on `opts.out` (default: stdout).
 *
 * The overlay is NON-INTERACTIVE — silvery's run() is invoked with
 * `input: false`, `mouse: false`, `selection: false`, `focusReporting: false`
 * so the host process keeps stdin ownership and the recorded child program
 * sees keystrokes unmodified.
 *
 * @param terminal Headless terminal that mirrors PTY output (used for the
 *   Viewport's cols/rows; the adapter sees PTY bytes via `handle.feed()`).
 * @param opts See {@link RecLiveOverlayOptions}.
 */
export async function startRecLiveOverlay(
  terminal: Terminal,
  opts: RecLiveOverlayOptions = {},
): Promise<RecLiveOverlayHandle> {
  const out = opts.out ?? process.stdout
  const chromeStyle: ChromeStyle = opts.chromeStyle ?? "macos"
  const title = opts.title ?? ""
  const initialElapsed = opts.startElapsedMs ?? 0

  const adapter = XtermAdapter({
    cols: terminal.cols,
    rows: terminal.rows,
    captureInput: "none",
  })

  // Feed-event fanout — React component subscribes to "adapter saw bytes"
  // so the silvery pipeline re-renders on every feed batch.
  const feedListeners = new Set<() => void>()
  const subscribeFeed = (listener: () => void): (() => void) => {
    feedListeners.add(listener)
    return () => {
      feedListeners.delete(listener)
    }
  }
  const notifyFeed = (): void => {
    for (const listener of feedListeners) {
      try {
        listener()
      } catch {
        // Listener failures must not block the recording pipeline.
      }
    }
  }

  // Controller — populated by the React component's bindController effect.
  let controller: RecOverlayController | null = null
  const bindController = (c: RecOverlayController): void => {
    controller = c
  }

  // Resolve hostCols / hostRows for the silvery runtime. silvery infers them
  // from `out.columns`/`out.rows` when not passed, but pass explicitly for
  // determinism (esp. in tests with a stubbed Writable).
  const hostCols = opts.hostCols ? opts.hostCols() : out.columns ?? 80
  const hostRows = opts.hostRows ? opts.hostRows() : out.rows ?? 24

  const handle = await run(
    <RecOverlay
      adapter={adapter}
      cols={terminal.cols}
      rows={terminal.rows}
      chromeStyle={chromeStyle}
      title={title}
      elapsedMs={initialElapsed}
      subscribeFeed={subscribeFeed}
      bindController={bindController}
    />,
    {
      stdout: out,
      cols: hostCols,
      rows: hostRows,
      input: false,
      mouse: false,
      selection: false,
      focusReporting: false,
    },
  )

  let stopped = false

  return {
    feed(data: Uint8Array | string): void {
      if (stopped) return
      adapter.feedAnsi(data)
      notifyFeed()
    },
    rerender(): void {
      // No-op — the adapter's microtask flush already marks the viewport dirty.
      // Kept for API parity with the old direct-ANSI painter.
    },
    repaint(): void {
      controller?.repaint()
    },
    setElapsedMs(ms: number): void {
      controller?.setElapsedMs(ms)
    },
    async stop(): Promise<void> {
      if (stopped) return
      stopped = true
      try {
        // silvery's RunHandle exposes `unmount()` (sync) — the alt-screen
        // leave + protocol-disable sequences are emitted synchronously
        // inside it via the runtime's terminal-protocol cleanup path.
        handle.unmount()
      } catch {
        // Best-effort — silvery may already be unwinding.
      }
    },
  }
}
