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
  assertIsDim,
  assertIsStrikethrough,
  assertIsInverse,
  assertIsWide,
  assertHasUnderline,
  assertHasFg,
  assertHasBg,
  assertHaveAttrs,
  assertCursorAt,
  assertCursorStyle,
  assertCursorVisible,
  assertCursorHidden,
  assertHaveCursor,
  assertInMode,
  assertTitle,
  assertScrollbackLines,
  assertAtBottomOfScrollback,
  type AssertionResult,
  type CellAttrs,
  type CursorProps,
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

  /** Assert multiple cell attributes at once. */
  toHaveAttrs(received: unknown, attrs: CellAttrs) {
    assertCellView(received, "toHaveAttrs")
    return toMatcherResult(assertHaveAttrs(received, attrs))
  },

  /** @deprecated Use toHaveAttrs({ bold: true }) */
  toBeBold(received: unknown) {
    assertCellView(received, "toBeBold")
    return toMatcherResult(assertIsBold(received))
  },

  /** @deprecated Use toHaveAttrs({ italic: true }) */
  toBeItalic(received: unknown) {
    assertCellView(received, "toBeItalic")
    return toMatcherResult(assertIsItalic(received))
  },

  /** @deprecated Use toHaveAttrs({ dim: true }) */
  toBeDim(received: unknown) {
    assertCellView(received, "toBeDim")
    return toMatcherResult(assertIsDim(received))
  },

  /** @deprecated Use toHaveAttrs({ strikethrough: true }) */
  toBeStrikethrough(received: unknown) {
    assertCellView(received, "toBeStrikethrough")
    return toMatcherResult(assertIsStrikethrough(received))
  },

  /** @deprecated Use toHaveAttrs({ inverse: true }) */
  toBeInverse(received: unknown) {
    assertCellView(received, "toBeInverse")
    return toMatcherResult(assertIsInverse(received))
  },

  /** @deprecated Use toHaveAttrs({ wide: true }) */
  toBeWide(received: unknown) {
    assertCellView(received, "toBeWide")
    return toMatcherResult(assertIsWide(received))
  },

  /** @deprecated Use toHaveAttrs({ underline: true }) or toHaveAttrs({ underline: "curly" }) */
  toHaveUnderline(received: unknown, style?: UnderlineStyle) {
    assertCellView(received, "toHaveUnderline")
    return toMatcherResult(assertHasUnderline(received, style))
  },

  /** @deprecated Use toHaveAttrs({ fg: color }) */
  toHaveFg(received: unknown, color: string | RGB) {
    assertCellView(received, "toHaveFg")
    return toMatcherResult(assertHasFg(received, color))
  },

  /** @deprecated Use toHaveAttrs({ bg: color }) */
  toHaveBg(received: unknown, color: string | RGB) {
    assertCellView(received, "toHaveBg")
    return toMatcherResult(assertHasBg(received, color))
  },

  // ── Terminal Matchers (TerminalReadable) ──

  /** Assert multiple cursor properties at once. */
  toHaveCursor(received: unknown, props: CursorProps) {
    assertTerminalReadable(received, "toHaveCursor")
    return toMatcherResult(assertHaveCursor(received, props))
  },

  /** @deprecated Use toHaveCursor({ x, y }) */
  toHaveCursorAt(received: unknown, x: number, y: number) {
    assertTerminalReadable(received, "toHaveCursorAt")
    return toMatcherResult(assertCursorAt(received, x, y))
  },

  /** @deprecated Use toHaveCursor({ style }) */
  toHaveCursorStyle(received: unknown, style: CursorStyle) {
    assertTerminalReadable(received, "toHaveCursorStyle")
    return toMatcherResult(assertCursorStyle(received, style))
  },

  /** @deprecated Use toHaveCursor({ visible: true }) */
  toHaveCursorVisible(received: unknown) {
    assertTerminalReadable(received, "toHaveCursorVisible")
    return toMatcherResult(assertCursorVisible(received))
  },

  /** @deprecated Use toHaveCursor({ visible: false }) */
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
