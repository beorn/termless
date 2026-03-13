/**
 * Custom Vitest matchers for terminal testing — Playwright-style auto-retry.
 *
 * Terminal views (term.screen, term.scrollback, etc.) are lazy evaluators —
 * they re-query the terminal backend on each access, just like Playwright
 * locators re-query the DOM. When you `await` a matcher, it auto-retries
 * until the assertion passes or the timeout expires.
 *
 * ```typescript
 * // Playwright
 * await expect(page.locator('.status')).toContainText('ready')
 *
 * // Termless — identical pattern
 * await expect(term.screen).toContainText('ready')
 * ```
 *
 * Sync usage still works — without `await`, assertions run once (instant):
 *
 * ```typescript
 * expect(term.screen).toContainText('Hello')       // sync, single check
 * await expect(term.screen).toContainText('Hello')  // async, retries up to 5s
 * ```
 *
 * Configure timeout globally or per-assertion:
 *
 * ```typescript
 * configureTerminalMatchers({ timeout: 10_000 })                   // global
 * await expect(term.screen).toContainText('slow', { timeout: 15_000 })  // per-call
 * ```
 *
 * ## Composable API
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
  isRegionView,
  isTerminalReadable,
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
  assertTextCount,
  assertTextVisible,
  assertTextHidden,
  withMessage,
  type AssertionResult,
} from "../../../src/assertions.ts"

// =============================================================================
// Auto-retry configuration
// =============================================================================

/** Options for auto-retrying assertions. */
export interface RetryOptions {
  /** Maximum time to retry in milliseconds. Default: 5000. */
  timeout?: number
  /** Polling interval in milliseconds. Default: 50. */
  interval?: number
  /** Custom error context prepended to the failure message. Like Playwright's `expect(loc, "context").` */
  message?: string
}

let globalTimeout = 5_000
let globalInterval = 50

/**
 * Configure default timeout and interval for auto-retrying matchers.
 *
 * ```typescript
 * configureTerminalMatchers({ timeout: 10_000 })  // 10s timeout
 * ```
 */
export function configureTerminalMatchers(options: RetryOptions): void {
  if (options.timeout !== undefined) globalTimeout = options.timeout
  if (options.interval !== undefined) globalInterval = options.interval
}

// =============================================================================
// Auto-retry engine
// =============================================================================

/**
 * Check if a value is a live terminal view that supports re-evaluation.
 * RegionViews and TerminalReadables re-query the backend on each call,
 * making them natural retry targets (like Playwright locators).
 */
function isRetryable(value: unknown): boolean {
  return isRegionView(value) || isTerminalReadable(value)
}

type MatcherResult = { pass: boolean; message: () => string }

/**
 * Retry an assertion until the desired outcome or timeout.
 *
 * @param isNot - Whether `.not` was used. When negated, retries until
 *   the assertion FAILS (pass=false), because vitest will invert it.
 *   This matches Playwright: `await expect(loc).not.toContainText('loading')`
 *   retries until the text disappears.
 */
async function retryAssertion(
  assertFn: () => AssertionResult,
  isNot: boolean,
  options: RetryOptions,
): Promise<MatcherResult> {
  const timeout = options.timeout ?? globalTimeout
  const interval = options.interval ?? globalInterval
  const customMessage = options.message
  const start = Date.now()

  const isDesiredOutcome = (r: AssertionResult) => (isNot ? !r.pass : r.pass)
  const applyMessage = (r: AssertionResult): AssertionResult => (customMessage ? withMessage(r, customMessage) : r)

  let lastResult = assertFn()
  if (isDesiredOutcome(lastResult)) {
    const r = applyMessage(lastResult)
    return { pass: r.pass, message: () => r.message }
  }

  while (Date.now() - start < timeout) {
    await new Promise<void>((r) => setTimeout(r, interval))
    lastResult = assertFn()
    if (isDesiredOutcome(lastResult)) {
      const r = applyMessage(lastResult)
      return { pass: r.pass, message: () => r.message }
    }
  }

  const elapsed = Date.now() - start
  const r = applyMessage(lastResult)
  return {
    pass: r.pass,
    message: () => `${r.message}\n\n(retried for ${elapsed}ms, timed out after ${timeout}ms)`,
  }
}

/**
 * Create a matcher that supports both sync and async (auto-retry) modes.
 *
 * - **Sync** (no options, or subject is not retryable): runs once, returns immediately
 * - **Async** (subject is retryable): returns a Promise that auto-retries
 *
 * The async path is triggered when `expect(retryableSubject).matcher()` is awaited.
 * Terminal views (term.screen, term.scrollback) are retryable — they re-query
 * the backend on each retry, like Playwright locators re-query the DOM.
 *
 * Negation-aware: when `.not` is used, retries until the assertion *fails*
 * (the desired outcome for `.not`), matching Playwright's behavior:
 *
 * ```typescript
 * // Retries until "loading" appears
 * await expect(term.screen).toContainText("loading")
 *
 * // Retries until "loading" disappears (Playwright-style .not retry)
 * await expect(term.screen).not.toContainText("loading")
 * ```
 */
function autoRetryMatcher(
  received: unknown,
  assertFn: () => AssertionResult,
  isNot: boolean,
  options?: RetryOptions,
): MatcherResult | Promise<MatcherResult> {
  const result = assertFn()
  const customMessage = options?.message

  // Apply custom message to sync results
  const applyMessage = (r: AssertionResult): AssertionResult => (customMessage ? withMessage(r, customMessage) : r)

  // Not retryable or not a terminal view → always sync
  if (!isRetryable(received)) {
    const r = applyMessage(result)
    return { pass: r.pass, message: () => r.message }
  }

  // Check if the current result is already the desired outcome:
  // - Normal (.not=false): pass=true is desired
  // - Negated (.not=true): pass=false is desired (vitest inverts to true)
  const isDesiredOutcome = isNot ? !result.pass : result.pass
  if (isDesiredOutcome) {
    const r = applyMessage(result)
    return { pass: r.pass, message: () => r.message }
  }

  // Not the desired outcome on retryable subject → return Promise that retries
  return retryAssertion(assertFn, isNot, options ?? {})
}

// =============================================================================
// Helper: Convert AssertionResult to vitest matcher format
// =============================================================================

function toMatcherResult(result: AssertionResult): MatcherResult {
  return {
    pass: result.pass,
    message: () => result.message,
  }
}

// =============================================================================
// Matcher Type Declarations
// =============================================================================

declare module "vitest" {
  interface Matchers<T> {
    // Text (RegionView) — auto-retrying when awaited on terminal views
    toContainText(text: string, options?: RetryOptions): void
    toHaveText(text: string, options?: RetryOptions): void
    toMatchLines(lines: string[], options?: RetryOptions): void
    toHaveTextCount(text: string, count: number, options?: RetryOptions): void

    // Cell Style (CellView) — always sync (cells are point-in-time snapshots)
    toBeBold(): void
    toBeItalic(): void
    toBeDim(): void
    toBeStrikethrough(): void
    toBeInverse(): void
    toBeWide(): void
    toHaveUnderline(style?: UnderlineStyle): void
    toHaveFg(color: string | RGB): void
    toHaveBg(color: string | RGB): void

    // Terminal (TerminalReadable) — auto-retrying when awaited on terminal views
    toHaveCursorAt(x: number, y: number, options?: RetryOptions): void
    toHaveCursorStyle(style: CursorStyle, options?: RetryOptions): void
    toHaveCursorVisible(options?: RetryOptions): void
    toHaveCursorHidden(options?: RetryOptions): void
    toBeInMode(mode: TerminalMode, options?: RetryOptions): void
    toHaveTitle(title: string, options?: RetryOptions): void
    toHaveScrollbackLines(n: number, options?: RetryOptions): void
    toBeAtBottomOfScrollback(options?: RetryOptions): void
    toHaveVisibleText(text: string, options?: RetryOptions): void
    toHaveHiddenText(text: string, options?: RetryOptions): void

    // Snapshot (TerminalReadable)
    toMatchTerminalSnapshot(options?: { name?: string }): void
    toMatchSvgSnapshot(options?: { name?: string; theme?: SvgTheme }): void
  }
}

// =============================================================================
// Matcher Implementations
// =============================================================================

export const terminalMatchers = {
  // ── Text Matchers (RegionView) — auto-retrying ──

  /** Assert region contains the given text as a substring. Auto-retries when awaited. */
  toContainText(this: { isNot: boolean }, received: unknown, text: string, options?: RetryOptions) {
    assertRegionView(received, "toContainText")
    return autoRetryMatcher(received, () => assertContainsText(received, text), this.isNot, options)
  },

  /** Assert region text matches exactly after trimming. Auto-retries when awaited. */
  toHaveText(this: { isNot: boolean }, received: unknown, text: string, options?: RetryOptions) {
    assertRegionView(received, "toHaveText")
    return autoRetryMatcher(received, () => assertHasText(received, text), this.isNot, options)
  },

  /** Assert region lines match expected lines. Auto-retries when awaited. */
  toMatchLines(this: { isNot: boolean }, received: unknown, expectedLines: string[], options?: RetryOptions) {
    assertRegionView(received, "toMatchLines")
    return autoRetryMatcher(received, () => assertMatchesLines(received, expectedLines), this.isNot, options)
  },

  /** Assert region contains exactly n occurrences of text. Auto-retries when awaited. */
  toHaveTextCount(this: { isNot: boolean }, received: unknown, text: string, count: number, options?: RetryOptions) {
    assertRegionView(received, "toHaveTextCount")
    return autoRetryMatcher(received, () => assertTextCount(received, text, count), this.isNot, options)
  },

  // ── Cell Style Matchers (CellView) — always sync ──

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

  /** Assert cell is dim (faint). */
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

  // ── Terminal Matchers (TerminalReadable) — auto-retrying ──

  /** Assert cursor is at the given position. Auto-retries when awaited. */
  toHaveCursorAt(this: { isNot: boolean }, received: unknown, x: number, y: number, options?: RetryOptions) {
    assertTerminalReadable(received, "toHaveCursorAt")
    return autoRetryMatcher(received, () => assertCursorAt(received, x, y), this.isNot, options)
  },

  /** Assert cursor has a specific style (block, underline, beam). Auto-retries when awaited. */
  toHaveCursorStyle(this: { isNot: boolean }, received: unknown, style: CursorStyle, options?: RetryOptions) {
    assertTerminalReadable(received, "toHaveCursorStyle")
    return autoRetryMatcher(received, () => assertCursorStyle(received, style), this.isNot, options)
  },

  /** Assert cursor is visible. Auto-retries when awaited. */
  toHaveCursorVisible(this: { isNot: boolean }, received: unknown, options?: RetryOptions) {
    assertTerminalReadable(received, "toHaveCursorVisible")
    return autoRetryMatcher(received, () => assertCursorVisible(received), this.isNot, options)
  },

  /** Assert cursor is hidden. Auto-retries when awaited. */
  toHaveCursorHidden(this: { isNot: boolean }, received: unknown, options?: RetryOptions) {
    assertTerminalReadable(received, "toHaveCursorHidden")
    return autoRetryMatcher(received, () => assertCursorHidden(received), this.isNot, options)
  },

  /** Assert a specific terminal mode is enabled. Auto-retries when awaited. */
  toBeInMode(this: { isNot: boolean }, received: unknown, mode: TerminalMode, options?: RetryOptions) {
    assertTerminalReadable(received, "toBeInMode")
    return autoRetryMatcher(received, () => assertInMode(received, mode), this.isNot, options)
  },

  /** Assert terminal has a specific title. Auto-retries when awaited. */
  toHaveTitle(this: { isNot: boolean }, received: unknown, title: string, options?: RetryOptions) {
    assertTerminalReadable(received, "toHaveTitle")
    return autoRetryMatcher(received, () => assertTitle(received, title), this.isNot, options)
  },

  /** Assert scrollback has a specific number of lines. Auto-retries when awaited. */
  toHaveScrollbackLines(this: { isNot: boolean }, received: unknown, n: number, options?: RetryOptions) {
    assertTerminalReadable(received, "toHaveScrollbackLines")
    return autoRetryMatcher(received, () => assertScrollbackLines(received, n), this.isNot, options)
  },

  /** Assert viewport is at the bottom of scrollback. Auto-retries when awaited. */
  toBeAtBottomOfScrollback(this: { isNot: boolean }, received: unknown, options?: RetryOptions) {
    assertTerminalReadable(received, "toBeAtBottomOfScrollback")
    return autoRetryMatcher(received, () => assertAtBottomOfScrollback(received), this.isNot, options)
  },

  /** Assert text is visible on the current screen. Auto-retries when awaited. */
  toHaveVisibleText(this: { isNot: boolean }, received: unknown, text: string, options?: RetryOptions) {
    assertTerminalReadable(received, "toHaveVisibleText")
    return autoRetryMatcher(received, () => assertTextVisible(received, text), this.isNot, options)
  },

  /** Assert text is not visible on screen (may exist in scrollback). Auto-retries when awaited. */
  toHaveHiddenText(this: { isNot: boolean }, received: unknown, text: string, options?: RetryOptions) {
    assertTerminalReadable(received, "toHaveHiddenText")
    return autoRetryMatcher(received, () => assertTextHidden(received, text), this.isNot, options)
  },

  // ── Snapshot Matchers (TerminalReadable, vitest-only) ──

  /** Match terminal content against a snapshot. */
  toMatchTerminalSnapshot(received: unknown, options?: { name?: string }) {
    assertTerminalReadable(received, "toMatchTerminalSnapshot")
    const lines = received.getLines()
    const cursor = received.getCursor()
    const altScreen = received.getMode("altScreen")

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

    const snapshot = `${header}\n${sep}\n${body}`

    return {
      pass: (expect as unknown as { getState(): { snapshotState: unknown } }).getState?.()?.snapshotState !== undefined,
      message: () => `Terminal snapshot comparison`,
      actual: snapshot,
      expected: options?.name ?? "terminal snapshot",
    }
  },

  /** Match terminal SVG screenshot against a snapshot. */
  toMatchSvgSnapshot(received: unknown, options?: { name?: string; theme?: SvgTheme }) {
    assertTerminalReadable(received, "toMatchSvgSnapshot")
    const svgOptions: SvgScreenshotOptions | undefined = options?.theme ? { theme: options.theme } : undefined
    const svg = screenshotSvg(received, svgOptions)

    return {
      pass: (expect as unknown as { getState(): { snapshotState: unknown } }).getState?.()?.snapshotState !== undefined,
      message: () => `SVG terminal snapshot comparison`,
      actual: svg,
      expected: options?.name ?? "svg terminal snapshot",
    }
  },
}

// Auto-register matchers when this module is imported
expect.extend(terminalMatchers)
