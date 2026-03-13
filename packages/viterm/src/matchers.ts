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
// Matcher Type Declarations
// =============================================================================

declare module "vitest" {
  interface Matchers<T> {
    // Text (RegionView)
    toContainText(text: string): void
    toHaveText(text: string): void
    toMatchLines(lines: string[]): void

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

    // Terminal (TerminalReadable)
    toHaveCursorAt(x: number, y: number): void
    toHaveCursorStyle(style: CursorStyle): void
    toHaveCursorVisible(): void
    toHaveCursorHidden(): void
    toBeInMode(mode: TerminalMode): void
    toHaveTitle(title: string): void
    toHaveScrollbackLines(n: number): void
    toBeAtBottomOfScrollback(): void

    // Snapshot (TerminalReadable)
    toMatchTerminalSnapshot(options?: { name?: string }): void
    toMatchSvgSnapshot(options?: { name?: string; theme?: SvgTheme }): void
  }
}

// =============================================================================
// Matcher Implementations
// =============================================================================

export const terminalMatchers = {
  // ── Text Matchers (RegionView) ──

  /** Assert region contains the given text as a substring. */
  toContainText(received: unknown, text: string) {
    assertRegionView(received, "toContainText")
    return toMatcherResult(assertContainsText(received, text))
  },

  /** Assert region text matches exactly after trimming. */
  toHaveText(received: unknown, text: string) {
    assertRegionView(received, "toHaveText")
    return toMatcherResult(assertHasText(received, text))
  },

  /** Assert region lines match expected lines (trailing whitespace trimmed per line). */
  toMatchLines(received: unknown, expectedLines: string[]) {
    assertRegionView(received, "toMatchLines")
    return toMatcherResult(assertMatchesLines(received, expectedLines))
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

  // ── Terminal Matchers (TerminalReadable) ──

  /** Assert cursor is at the given position. */
  toHaveCursorAt(received: unknown, x: number, y: number) {
    assertTerminalReadable(received, "toHaveCursorAt")
    return toMatcherResult(assertCursorAt(received, x, y))
  },

  /** Assert cursor has a specific style (block, underline, beam). */
  toHaveCursorStyle(received: unknown, style: CursorStyle) {
    assertTerminalReadable(received, "toHaveCursorStyle")
    return toMatcherResult(assertCursorStyle(received, style))
  },

  /** Assert cursor is visible. */
  toHaveCursorVisible(received: unknown) {
    assertTerminalReadable(received, "toHaveCursorVisible")
    return toMatcherResult(assertCursorVisible(received))
  },

  /** Assert cursor is hidden. */
  toHaveCursorHidden(received: unknown) {
    assertTerminalReadable(received, "toHaveCursorHidden")
    return toMatcherResult(assertCursorHidden(received))
  },

  /** Assert a specific terminal mode is enabled. */
  toBeInMode(received: unknown, mode: TerminalMode) {
    assertTerminalReadable(received, "toBeInMode")
    return toMatcherResult(assertInMode(received, mode))
  },

  /** Assert terminal has a specific title (set via OSC escape). */
  toHaveTitle(received: unknown, title: string) {
    assertTerminalReadable(received, "toHaveTitle")
    return toMatcherResult(assertTitle(received, title))
  },

  /** Assert scrollback has a specific number of lines. */
  toHaveScrollbackLines(received: unknown, n: number) {
    assertTerminalReadable(received, "toHaveScrollbackLines")
    return toMatcherResult(assertScrollbackLines(received, n))
  },

  /** Assert viewport is at the bottom of scrollback (no scroll offset). */
  toBeAtBottomOfScrollback(received: unknown) {
    assertTerminalReadable(received, "toBeAtBottomOfScrollback")
    return toMatcherResult(assertAtBottomOfScrollback(received))
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
