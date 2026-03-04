/**
 * Jest/Bun-compatible matcher adapter for terminal testing.
 *
 * Wraps the pure assertion functions from ./assertions.ts into the
 * Jest `expect.extend()` format. Works with Jest, Bun test, and any
 * runner that supports `expect.extend({ matcherName(received, ...args) })`.
 *
 * Usage:
 *   import { termlessMatchers } from "@termless/core"
 *   expect.extend(termlessMatchers)
 *
 *   // Then use matchers:
 *   expect(term.screen).toContainText("Hello")
 *   expect(term.cell(0, 0)).toBeBold()
 *   expect(term).toHaveCursorAt(5, 10)
 */

import type { CursorStyle, RGB, TerminalMode, UnderlineStyle } from "./types.ts"
import {
  assertRegionView,
  assertCellView,
  assertTerminalReadable,
  assertContainsText,
  assertHasText,
  assertMatchesLines,
  assertIsBold,
  assertIsItalic,
  assertIsFaint,
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
  type AssertionResult,
} from "./assertions.ts"

/** Convert an AssertionResult to the { pass, message() } format Jest/vitest expect. */
function toMatcherResult(result: AssertionResult) {
  return {
    pass: result.pass,
    message: () => result.message,
  }
}

/**
 * Terminal matchers compatible with Jest's `expect.extend()`.
 * Also works with Bun test and any Jest-compatible expect implementation.
 *
 * @example
 * ```typescript
 * import { termlessMatchers } from "@termless/core"
 * expect.extend(termlessMatchers)
 * ```
 */
export const termlessMatchers = {
  // ── Text Matchers (RegionView) ──

  toContainText(received: unknown, text: string) {
    assertRegionView(received, "toContainText")
    return toMatcherResult(assertContainsText(received, text))
  },

  toHaveText(received: unknown, text: string) {
    assertRegionView(received, "toHaveText")
    return toMatcherResult(assertHasText(received, text))
  },

  toMatchLines(received: unknown, lines: string[]) {
    assertRegionView(received, "toMatchLines")
    return toMatcherResult(assertMatchesLines(received, lines))
  },

  // ── Cell Style Matchers (CellView) ──

  toBeBold(received: unknown) {
    assertCellView(received, "toBeBold")
    return toMatcherResult(assertIsBold(received))
  },

  toBeItalic(received: unknown) {
    assertCellView(received, "toBeItalic")
    return toMatcherResult(assertIsItalic(received))
  },

  toBeFaint(received: unknown) {
    assertCellView(received, "toBeFaint")
    return toMatcherResult(assertIsFaint(received))
  },

  toBeStrikethrough(received: unknown) {
    assertCellView(received, "toBeStrikethrough")
    return toMatcherResult(assertIsStrikethrough(received))
  },

  toBeInverse(received: unknown) {
    assertCellView(received, "toBeInverse")
    return toMatcherResult(assertIsInverse(received))
  },

  toBeWide(received: unknown) {
    assertCellView(received, "toBeWide")
    return toMatcherResult(assertIsWide(received))
  },

  toHaveUnderline(received: unknown, style?: UnderlineStyle) {
    assertCellView(received, "toHaveUnderline")
    return toMatcherResult(assertHasUnderline(received, style))
  },

  toHaveFg(received: unknown, color: string | RGB) {
    assertCellView(received, "toHaveFg")
    return toMatcherResult(assertHasFg(received, color))
  },

  toHaveBg(received: unknown, color: string | RGB) {
    assertCellView(received, "toHaveBg")
    return toMatcherResult(assertHasBg(received, color))
  },

  // ── Terminal Matchers (TerminalReadable) ──

  toHaveCursorAt(received: unknown, x: number, y: number) {
    assertTerminalReadable(received, "toHaveCursorAt")
    return toMatcherResult(assertCursorAt(received, x, y))
  },

  toHaveCursorStyle(received: unknown, style: CursorStyle) {
    assertTerminalReadable(received, "toHaveCursorStyle")
    return toMatcherResult(assertCursorStyle(received, style))
  },

  toHaveCursorVisible(received: unknown) {
    assertTerminalReadable(received, "toHaveCursorVisible")
    return toMatcherResult(assertCursorVisible(received))
  },

  toHaveCursorHidden(received: unknown) {
    assertTerminalReadable(received, "toHaveCursorHidden")
    return toMatcherResult(assertCursorHidden(received))
  },

  toBeInMode(received: unknown, mode: TerminalMode) {
    assertTerminalReadable(received, "toBeInMode")
    return toMatcherResult(assertInMode(received, mode))
  },

  toHaveTitle(received: unknown, title: string) {
    assertTerminalReadable(received, "toHaveTitle")
    return toMatcherResult(assertTitle(received, title))
  },

  toHaveScrollbackLines(received: unknown, n: number) {
    assertTerminalReadable(received, "toHaveScrollbackLines")
    return toMatcherResult(assertScrollbackLines(received, n))
  },

  toBeAtBottomOfScrollback(received: unknown) {
    assertTerminalReadable(received, "toBeAtBottomOfScrollback")
    return toMatcherResult(assertAtBottomOfScrollback(received))
  },
}
