/**
 * First-paint gate for the `record` verb's frame-capture loop.
 *
 * A recorded command emits leading noise before its real UI appears: a shell
 * echoing the command line, an interpreter's startup banner, a blank pre-paint
 * buffer. Capturing those makes frame 0 of the GIF an idle screen — the
 * "recorded nothing" symptom.
 *
 * The gate drops that noise with two rules:
 *
 *   - **Blank screens are never frames.** A whitespace-only buffer is skipped.
 *   - **Alt-screen entry discards the lead-in.** Every TUI switches to the
 *     alternate screen buffer when it starts. Anything captured before that
 *     switch was pre-UI noise (shell echo, banner) — when the switch happens,
 *     the caller drops every already-captured frame, so frame 0 is the first
 *     painted TUI frame.
 *
 * A plain non-TUI command (`ls`, a build log) never enters the alt screen; for
 * those the gate just skips blank frames and captures output as it appears.
 */

/** Per-tick verdict from {@link FrameGate.observe}. */
export interface FrameVerdict {
  /** Whether this tick's screen is a real frame worth capturing. */
  capture: boolean
  /**
   * True exactly once — on the tick the command enters the alternate screen.
   * The caller must discard every frame captured before this tick (they were
   * pre-UI lead-in noise).
   */
  resetPrior: boolean
}

/** Stateful first-paint gate. One per `record` run. */
export interface FrameGate {
  /** Observe the current screen each capture tick. */
  observe(text: string, altScreen: boolean): FrameVerdict
  /** Whether the command ever entered the alternate screen (i.e. is a TUI). */
  enteredAltScreen(): boolean
}

/** Create a {@link FrameGate} for one recording. */
export function createFrameGate(): FrameGate {
  let altScreenSeen = false
  return {
    observe(text: string, altScreen: boolean): FrameVerdict {
      let resetPrior = false
      if (!altScreenSeen && altScreen) {
        altScreenSeen = true
        resetPrior = true
      }
      return { capture: text.trim().length > 0, resetPrior }
    },
    enteredAltScreen(): boolean {
      return altScreenSeen
    },
  }
}
