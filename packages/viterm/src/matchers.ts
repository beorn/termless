/**
 * Custom Vitest matchers for terminal testing.
 *
 * Composable matchers that work with region selectors (RegionView, CellView)
 * and terminal-level queries (TerminalReadable). The composable pattern is:
 *
 *   expect(term.screen).toContainText("Hello")     // RegionView text matcher
 *   expect(term.cell(0, 0)).toBeBold()              // CellView style matcher
 *   expect(term).toHaveCursorAt(5, 10)              // Terminal matcher
 *
 * Import this module for side-effect registration:
 *   import "@termless/test/matchers"
 *
 * Or import the matcher object for manual registration:
 *   import { terminalMatchers } from "@termless/test/matchers"
 *   expect.extend(terminalMatchers)
 *
 * All assertion logic is delegated to termless/src/assertions.ts — this module
 * only adds vitest-specific wrappers (type declarations + snapshot matchers).
 */

import { expect } from "vitest"
import type {
  TerminalReadable,
  CursorStyle,
  RGB,
  TerminalMode,
  UnderlineStyle,
  SvgScreenshotOptions,
  SvgTheme,
} from "../../../src/types.ts"
import { screenshotSvg } from "../../../src/svg.ts"
import {
  assertRegionView,
  assertCellView,
  assertTerminalReadable,
  assertContainsText,
  assertHasText,
  assertMatchesLines,
  assertIsBold,
  assertIsItalic,
  assertIsDim,
  assertIsStrikethrough,
  assertIsInverse,
  assertIsWide,
  assertHasUnderline,
  assertHasFg,
  assertHasBg,
  assertCursorAt,
  assertCursorStyle,
  assertCursorVisible,
  assertCursorHidden,
  assertInMode,
  assertTitle,
  assertScrollbackLines,
  assertAtBottomOfScrollback,
  assertClipboardText,
  type AssertionResult,
} from "../../../src/assertions.ts"

// =============================================================================
// Helper: Convert AssertionResult to vitest matcher format
// =============================================================================

function toMatcherResult(result: AssertionResult) {
  return {
    pass: result.pass,
    message: () => result.message,
  }
}

// =============================================================================
// Auto-Retry (Playwright-style): return Promise when timeout is specified
// =============================================================================

const RETRY_INTERVAL = 50

/**
 * If timeout is specified, return a Promise that polls until the assertion
 * passes or times out. Otherwise return the sync result immediately.
 *
 * This enables the Playwright pattern:
 *   expect(x).toContainText("y")                    // sync, throws immediately
 *   await expect(x).toContainText("y", { timeout })  // async, polls until pass
 *
 * RegionView is a lazy getter that re-reads the backend on every getText() call,
 * so re-invoking the assertion picks up terminal changes automatically.
 */
function maybeRetry(
  assertFn: () => AssertionResult,
  timeout?: number,
): ReturnType<typeof toMatcherResult> | Promise<ReturnType<typeof toMatcherResult>> {
  const syncResult = assertFn()
  if (!timeout || syncResult.pass) {
    return toMatcherResult(syncResult)
  }
  // Return a Promise — vitest detects this and awaits it
  return new Promise<ReturnType<typeof toMatcherResult>>((resolve) => {
    const start = Date.now()
    const poll = () => {
      const result = assertFn()
      if (result.pass || Date.now() - start >= timeout) {
        resolve(toMatcherResult(result))
      } else {
        setTimeout(poll, RETRY_INTERVAL)
      }
    }
    setTimeout(poll, RETRY_INTERVAL)
  })
}

// =============================================================================
// Matcher Type Declarations
// =============================================================================

/** Options for auto-retry matchers (Playwright-style). */
interface RetryOptions {
  /** Timeout in ms for auto-retry when awaited. Without this, assertion is synchronous. */
  timeout?: number
}

declare module "vitest" {
  interface Matchers<T> {
    // Text (RegionView) — pass { timeout } for Playwright-style auto-retry
    toContainText(text: string, options?: RetryOptions): void
    toHaveText(text: string, options?: RetryOptions): void
    toMatchLines(lines: string[], options?: RetryOptions): void

    // Cell Style (CellView)
    toBeBold(): void
    toBeItalic(): void
    toBeDim(): void
    toBeStrikethrough(): void
    toBeInverse(): void
    toBeWide(): void
    toHaveUnderline(style?: UnderlineStyle): void
    toHaveFg(color: string | RGB): void
    toHaveBg(color: string | RGB): void

    // Terminal (TerminalReadable) — pass { timeout } for Playwright-style auto-retry
    toHaveCursorAt(x: number, y: number, options?: RetryOptions): void
    toHaveCursorStyle(style: CursorStyle, options?: RetryOptions): void
    toHaveCursorVisible(options?: RetryOptions): void
    toHaveCursorHidden(options?: RetryOptions): void
    toBeInMode(mode: TerminalMode, options?: RetryOptions): void
    toHaveTitle(title: string, options?: RetryOptions): void
    toHaveScrollbackLines(n: number, options?: RetryOptions): void
    toBeAtBottomOfScrollback(options?: RetryOptions): void

    // Clipboard (Terminal)
    toHaveClipboardText(text: string): void

    // Snapshot (TerminalReadable)
    toMatchTerminalSnapshot(options?: { name?: string }): void
    toMatchSvgSnapshot(options?: { name?: string; theme?: SvgTheme }): void
  }
}

// =============================================================================
// Snapshot Helpers
// =============================================================================

/** Format terminal state as a human-readable snapshot string. */
function formatTerminalSnapshot(term: TerminalReadable): string {
  const lines = term.getLines()
  const cursor = term.getCursor()
  const altScreen = term.getMode("altScreen")

  const cols = lines[0]?.length ?? 0
  let header = `# terminal ${cols}x${lines.length}`
  header += ` | cursor (${cursor.x},${cursor.y}) ${cursor.visible ? "visible" : "hidden"} ${cursor.style}`
  if (altScreen) header += " | altScreen"

  const sep = "\u2500".repeat(50)
  const body = lines
    .map((line, row) => {
      const num = String(row + 1).padStart(2)
      const text = line.map((c) => c.char || " ").join("")
      return `${num}\u2502${text}`
    })
    .join("\n")

  return `${header}\n${sep}\n${body}`
}

// =============================================================================
// Matcher Implementations
// =============================================================================

export const terminalMatchers = {
  // ── Text Matchers (RegionView) ──

  /** Assert region contains the given text as a substring. Auto-retries when { timeout } is passed. */
  toContainText(received: unknown, text: string, options?: RetryOptions) {
    assertRegionView(received, "toContainText")
    return maybeRetry(() => assertContainsText(received, text), options?.timeout)
  },

  /** Assert region text matches exactly after trimming. Auto-retries when { timeout } is passed. */
  toHaveText(received: unknown, text: string, options?: RetryOptions) {
    assertRegionView(received, "toHaveText")
    return maybeRetry(() => assertHasText(received, text), options?.timeout)
  },

  /** Assert region lines match expected lines (trailing whitespace trimmed per line). Auto-retries when { timeout } is passed. */
  toMatchLines(received: unknown, expectedLines: string[], options?: RetryOptions) {
    assertRegionView(received, "toMatchLines")
    return maybeRetry(() => assertMatchesLines(received, expectedLines), options?.timeout)
  },

  // ── Cell Style Matchers (CellView) ──

  /** Assert cell is bold. */
  toBeBold(received: unknown) {
    assertCellView(received, "toBeBold")
    return toMatcherResult(assertIsBold(received))
  },

  /** Assert cell is italic. */
  toBeItalic(received: unknown) {
    assertCellView(received, "toBeItalic")
    return toMatcherResult(assertIsItalic(received))
  },

  /** Assert cell is dim. */
  toBeDim(received: unknown) {
    assertCellView(received, "toBeDim")
    return toMatcherResult(assertIsDim(received))
  },

  /** Assert cell has strikethrough. */
  toBeStrikethrough(received: unknown) {
    assertCellView(received, "toBeStrikethrough")
    return toMatcherResult(assertIsStrikethrough(received))
  },

  /** Assert cell has inverse video. */
  toBeInverse(received: unknown) {
    assertCellView(received, "toBeInverse")
    return toMatcherResult(assertIsInverse(received))
  },

  /** Assert cell is wide (double-width character). */
  toBeWide(received: unknown) {
    assertCellView(received, "toBeWide")
    return toMatcherResult(assertIsWide(received))
  },

  /** Assert cell has underline. Optionally check specific style. */
  toHaveUnderline(received: unknown, style?: UnderlineStyle) {
    assertCellView(received, "toHaveUnderline")
    return toMatcherResult(assertHasUnderline(received, style))
  },

  /** Assert cell foreground color. Accepts hex string or {r,g,b}. */
  toHaveFg(received: unknown, color: string | RGB) {
    assertCellView(received, "toHaveFg")
    return toMatcherResult(assertHasFg(received, color))
  },

  /** Assert cell background color. Accepts hex string or {r,g,b}. */
  toHaveBg(received: unknown, color: string | RGB) {
    assertCellView(received, "toHaveBg")
    return toMatcherResult(assertHasBg(received, color))
  },

  // ── Terminal Matchers (TerminalReadable) ──

  /** Assert cursor is at the given position. Auto-retries when { timeout } is passed. */
  toHaveCursorAt(received: unknown, x: number, y: number, options?: RetryOptions) {
    assertTerminalReadable(received, "toHaveCursorAt")
    return maybeRetry(() => assertCursorAt(received, x, y), options?.timeout)
  },

  /** Assert cursor has a specific style (block, underline, beam). Auto-retries when { timeout } is passed. */
  toHaveCursorStyle(received: unknown, style: CursorStyle, options?: RetryOptions) {
    assertTerminalReadable(received, "toHaveCursorStyle")
    return maybeRetry(() => assertCursorStyle(received, style), options?.timeout)
  },

  /** Assert cursor is visible. Auto-retries when { timeout } is passed. */
  toHaveCursorVisible(received: unknown, options?: RetryOptions) {
    assertTerminalReadable(received, "toHaveCursorVisible")
    return maybeRetry(() => assertCursorVisible(received), options?.timeout)
  },

  /** Assert cursor is hidden. Auto-retries when { timeout } is passed. */
  toHaveCursorHidden(received: unknown, options?: RetryOptions) {
    assertTerminalReadable(received, "toHaveCursorHidden")
    return maybeRetry(() => assertCursorHidden(received), options?.timeout)
  },

  /** Assert a specific terminal mode is enabled. Auto-retries when { timeout } is passed. */
  toBeInMode(received: unknown, mode: TerminalMode, options?: RetryOptions) {
    assertTerminalReadable(received, "toBeInMode")
    return maybeRetry(() => assertInMode(received, mode), options?.timeout)
  },

  /** Assert terminal has a specific title (set via OSC escape). Auto-retries when { timeout } is passed. */
  toHaveTitle(received: unknown, title: string, options?: RetryOptions) {
    assertTerminalReadable(received, "toHaveTitle")
    return maybeRetry(() => assertTitle(received, title), options?.timeout)
  },

  /** Assert scrollback has a specific number of lines. Auto-retries when { timeout } is passed. */
  toHaveScrollbackLines(received: unknown, n: number, options?: RetryOptions) {
    assertTerminalReadable(received, "toHaveScrollbackLines")
    return maybeRetry(() => assertScrollbackLines(received, n), options?.timeout)
  },

  /** Assert viewport is at the bottom of scrollback (no scroll offset). Auto-retries when { timeout } is passed. */
  toBeAtBottomOfScrollback(received: unknown, options?: RetryOptions) {
    assertTerminalReadable(received, "toBeAtBottomOfScrollback")
    return maybeRetry(() => assertAtBottomOfScrollback(received), options?.timeout)
  },

  // ── Clipboard Matchers (Terminal) ──

  /** Assert terminal has captured the given text via OSC 52 clipboard write. */
  toHaveClipboardText(received: unknown, text: string) {
    if (!received || typeof received !== "object" || !("clipboardWrites" in received)) {
      throw new TypeError("toHaveClipboardText expects a Terminal with clipboardWrites")
    }
    const writes = (received as { clipboardWrites: readonly string[] }).clipboardWrites
    return toMatcherResult(assertClipboardText(writes, text))
  },

  // ── Snapshot Matchers (TerminalReadable, vitest-only) ──

  /** Match terminal content against a snapshot. */
  toMatchTerminalSnapshot(received: unknown, options?: { name?: string }) {
    assertTerminalReadable(received, "toMatchTerminalSnapshot")
    const snapshot = formatTerminalSnapshot(received)

    // Delegate to Vitest's built-in snapshot machinery
    try {
      expect(snapshot).toMatchSnapshot(options?.name)
      return {
        pass: true,
        message: () => `Expected terminal snapshot not to match`,
      }
    } catch (error) {
      return {
        pass: false,
        message: () => (error instanceof Error ? error.message : String(error)),
      }
    }
  },

  /** Match terminal SVG screenshot against a snapshot. */
  toMatchSvgSnapshot(received: unknown, options?: { name?: string; theme?: SvgTheme }) {
    assertTerminalReadable(received, "toMatchSvgSnapshot")
    const svgOptions: SvgScreenshotOptions | undefined = options?.theme ? { theme: options.theme } : undefined
    const svg = screenshotSvg(received, svgOptions)

    // Delegate to Vitest's built-in snapshot machinery
    try {
      expect(svg).toMatchSnapshot(options?.name)
      return {
        pass: true,
        message: () => `Expected SVG terminal snapshot not to match`,
      }
    } catch (error) {
      return {
        pass: false,
        message: () => (error instanceof Error ? error.message : String(error)),
      }
    }
  },
}

// Auto-register matchers when this module is imported
expect.extend(terminalMatchers)
