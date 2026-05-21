/**
 * Live recording chrome overlay — Silvery view of the headless terminal.
 *
 * `termless rec` captures the recorded program's output into a headless
 * terminal ({@link Terminal}). Without this overlay, the recorded bytes
 * would also pipe straight to the host terminal's stdout — the captured
 * 80×30 grid lands flush in the host's top-left with nothing around it, and
 * any TUI inside the recording (vim, htop, anything using absolute cursor
 * positioning) can paint outside that region.
 *
 * {@link RecorderLive} re-renders the headless terminal's cell grid through
 * Silvery — centered in the host terminal, wrapped in a {@link ChromeStyle}
 * frame (title bar, border, drop shadow). Because we render the cell grid
 * (not raw bytes), nothing the recorded program writes can escape the frame
 * — `\x1b[H`-style absolute moves land inside the headless terminal, not on
 * the host.
 *
 * The recorded artifact is unaffected — frame capture still reads the same
 * headless terminal at the same fps. This overlay is *live preview only*.
 */

import React, { useEffect, useState } from "react"
import { Box, Text, render } from "silvery"
import type { Terminal } from "../../../src/terminal/types.ts"
import type { ChromeStyle } from "../../../src/render/chrome.ts"
import { chromePresentation, rowToString } from "./rec-live-view-helpers.ts"

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

/** Props for {@link RecorderLive}. */
export interface RecorderLiveProps {
  /** The headless terminal whose cell grid is mirrored on the host. */
  terminal: Terminal
  /**
   * Subscribe to terminal updates. The returned function MUST be called to
   * unsubscribe. The component re-reads the grid on every notifier call.
   *
   * The parent (record-cmd.ts) wires this to the PTY's `onData` callback so
   * every byte the recorded program writes triggers a re-render of the
   * overlay.
   */
  subscribe?: (notify: () => void) => () => void
  /** Window chrome — same vocabulary as `--chrome`. Default `"macos"`. */
  chromeStyle?: ChromeStyle
  /** Title text in the chrome bar. Default `""`. */
  title?: string
}

/**
 * The live recorder view — centered, framed, mirrors the headless terminal's
 * cell grid. Re-reads the grid on every notifier call via {@link
 * RecorderLiveProps.subscribe}.
 */
export function RecorderLive({
  terminal,
  subscribe,
  chromeStyle = "macos",
  title = "",
}: RecorderLiveProps): React.ReactElement {
  // A monotonic counter — flipped on every terminal update. Drives the re-read
  // of `terminal.getLines()` on each render.
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!subscribe) return
    return subscribe(() => setTick((n) => n + 1))
  }, [subscribe])

  const presentation = chromePresentation(chromeStyle)
  const cols = terminal.cols
  const rows = terminal.rows

  // Read the current cell grid every render. The Terminal API mutates in place;
  // the snapshot is whatever the headless terminal looks like *right now*.
  const lines = terminal.getLines()
  // The buffer can be scrollback + screen; we want the visible screen only.
  // Visible rows are the trailing `rows` rows of the buffer.
  const visible = lines.slice(Math.max(0, lines.length - rows), lines.length)

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" padding={1}>
      <Box flexDirection="column" borderStyle={presentation.borderStyle ?? undefined}>
        {presentation.showTitleBar && (
          <Box flexDirection="row" paddingX={1}>
            {presentation.showDots && (
              <Text>
                <Text color="$error">● </Text>
                <Text color="$warning">● </Text>
                <Text color="$success">● </Text>
              </Text>
            )}
            <Text bold>{title}</Text>
          </Box>
        )}
        <Box flexDirection="column" width={cols} height={rows}>
          {Array.from({ length: rows }, (_, r) => (
            <Text key={r}>{rowToString(visible[r] ?? [], cols)}</Text>
          ))}
        </Box>
      </Box>
    </Box>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Mount helper
// ─────────────────────────────────────────────────────────────────────────────

/** Options for {@link runRecLiveView}. */
export interface RunRecLiveViewOptions {
  chromeStyle?: ChromeStyle
  title?: string
}

/** Handle returned by {@link runRecLiveView}. */
export interface RecLiveViewHandle {
  /** Force a re-render. Useful if the parent batches updates externally. */
  rerender(): void
  /** Unmount the overlay and clean up Silvery's render output. */
  unmount(): void
  /** Resolves when the overlay is unmounted. */
  waitUntilExit(): Promise<void>
  /** Pause output (so it can be torn down without screen artefacts). */
  pause(): void
  /** Resume output after pause. */
  resume(): void
}

/**
 * Mount the live recorder overlay onto the host terminal.
 *
 * Internally subscribes nothing automatically — the caller is expected to
 * call {@link RecLiveViewHandle.rerender} (or wire its own `subscribe` callback
 * via a wrapper) every time the headless terminal mutates. The recording loop
 * in `record-cmd.ts` calls `rerender()` from the PTY's `onData` hook.
 */
export async function runRecLiveView(terminal: Terminal, opts: RunRecLiveViewOptions = {}): Promise<RecLiveViewHandle> {
  let notifier: (() => void) | null = null
  const subscribe = (notify: () => void): (() => void) => {
    notifier = notify
    return () => {
      if (notifier === notify) notifier = null
    }
  }

  const instance = await render(
    <RecorderLive terminal={terminal} subscribe={subscribe} chromeStyle={opts.chromeStyle} title={opts.title} />,
    undefined,
    { mode: "fullscreen" },
  )

  return {
    rerender() {
      // Bumping the tick is preferred — it goes through React state, which
      // batches multiple updates into one paint. Calling instance.rerender()
      // would force a full reconciliation per byte from the PTY, which is
      // wasteful at PTY firehose rates.
      if (notifier) notifier()
    },
    unmount() {
      instance.unmount()
    },
    async waitUntilExit() {
      await instance.waitUntilExit()
    },
    pause() {
      instance.pause()
    },
    resume() {
      instance.resume()
    },
  }
}
