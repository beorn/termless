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

import type { CursorStyle, RGB, TerminalMode, UnderlineStyle } from "./terminal/types.ts"
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
 * Options accepted by the {@link termlessMatchers.toMatchAcrossRenderers}
 * matcher. The matcher forwards these straight to `captureCrossRenderer`, so
 * the surface is `CrossRendererOptions` (minus `cols`/`rows` — the matcher
 * fills those from the terminal) plus the matcher-only `dimensionTolerance`.
 */
export type ToMatchAcrossRenderersOptions = Omit<import("./compare.ts").CrossRendererOptions, "cols" | "rows"> & {
  /** Max canvas-vs-svg dimension drift before the matcher fails. Default 0.10. */
  dimensionTolerance?: number
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

  // ── Cross-Renderer Matcher ────────────────────────────────────
  /**
   * Capture the terminal's current buffer state via canvas + SVG (and
   * optionally peekaboo against a real terminal app), then assert the
   * three renderings agree on cell-grid dimensions + content. Saves all
   * three to `saveTo` for visual review.
   *
   * Hard invariant (always asserted):
   *   - SVG's natural dimensions match canvas's logical dimensions
   *     within `dimensionTolerance` (default 0.10 — 10%). Different DPRs
   *     and cell-pixel defaults make exact match impossible without
   *     unifying all parameters.
   *
   * Soft assertions (warn-only via report.notes when set):
   *   - Peekaboo dimensions roughly match expected window size
   *     (window chrome adds 60-100px height typically)
   *
   * @example
   * ```ts
   * await expect(term).toMatchAcrossRenderers({
   *   command: ["bash", "-c", "echo hello"],
   *   saveTo: "/tmp/diff",
   *   includePeekaboo: process.env.PEEKABOO === "1",
   * })
   * ```
   */
  async toMatchAcrossRenderers(
    received: unknown,
    options: ToMatchAcrossRenderersOptions = {},
  ): Promise<{ pass: boolean; message: () => string }> {
    assertTerminalReadable(received, "toMatchAcrossRenderers")
    const { captureCrossRenderer } = await import("./compare.ts")
    const term = received as import("./terminal/types.ts").Terminal
    const result = await captureCrossRenderer(term, {
      ...options,
      cols: term.cols,
      rows: term.rows,
    })
    const tol = options.dimensionTolerance ?? 0.1
    const canvas = result.report.dimensions.canvas
    const svg = result.report.dimensions.svg

    if (!canvas || !svg) {
      return {
        pass: false,
        message: () =>
          `toMatchAcrossRenderers: one renderer failed to produce dimensions (canvas=${canvas ? "ok" : "null"}, svg=${svg ? "ok" : "null"})`,
      }
    }

    // Canvas pixels are CSS-logical-px × DPR; SVG is plain logical px.
    // Try DPR=2 first (typical), pick whichever produces the closest
    // match — robust without plumbing meta through.
    let bestMatch = { dpr: 2, widthRatio: 1, heightRatio: 1 }
    for (const dpr of [2, 1]) {
      const cw = canvas.width / dpr
      const ch = canvas.height / dpr
      const wr = Math.abs(cw - svg.width) / Math.max(cw, svg.width)
      const hr = Math.abs(ch - svg.height) / Math.max(ch, svg.height)
      if (wr + hr < bestMatch.widthRatio + bestMatch.heightRatio) {
        bestMatch = { dpr, widthRatio: wr, heightRatio: hr }
      }
    }
    const widthRatio = bestMatch.widthRatio
    const heightRatio = bestMatch.heightRatio
    const canvasLogical = { width: canvas.width / bestMatch.dpr, height: canvas.height / bestMatch.dpr }

    const dimensionOk = widthRatio <= tol && heightRatio <= tol
    if (!dimensionOk) {
      const lines = [
        `toMatchAcrossRenderers: canvas vs svg dimension drift exceeds tolerance ${tol}:`,
        `  canvas: ${canvas.width}×${canvas.height} px (logical ${canvasLogical.width}×${canvasLogical.height})`,
        `  svg:    ${svg.width}×${svg.height} px`,
        `  width drift:  ${(widthRatio * 100).toFixed(1)}%`,
        `  height drift: ${(heightRatio * 100).toFixed(1)}%`,
      ]
      if (result.report.files) {
        lines.push(`  diff bundle: ${result.report.files.report}`)
      }
      return { pass: false, message: () => lines.join("\n") }
    }

    return {
      pass: true,
      message: () =>
        `Expected canvas + svg to differ by more than ${tol}, got widthDrift=${(widthRatio * 100).toFixed(1)}%, heightDrift=${(heightRatio * 100).toFixed(1)}%`,
    }
  },
}

// ── Vitest type augmentation ────────────────────────────────────
// `toMatchAcrossRenderers` is the only termless matcher consumed via
// `expect(x).toMatchAcrossRenderers(...)` (the rest are plain assertion
// functions in assertions.ts). Augment vitest's Assertion + Matchers
// interfaces so `tsc` knows about it once `expect.extend(termlessMatchers)`
// has run. Without this, typecheck fails with TS2339 on every call site.
// `toMatchAcrossRenderers` is registered via `expect.extend(termlessMatchers)`
// at runtime; this augmentation tells `tsc` about it. The `Matchers<T>`
// interface is the custom-matcher extension point — it is *declared* in
// `@vitest/expect` (vitest only re-exports the type), and `Assertion<T>`
// (what `expect()` returns) extends it. Augmenting `"vitest"` would create a
// fresh, unmerged interface and TS2339 would persist on every call site, so
// the augmentation must target `@vitest/expect` directly — declared as a
// devDependency for that reason. The `<T = any>` default must match vitest's
// own declaration exactly, otherwise TS2428 ("identical type parameters").
declare module "@vitest/expect" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  interface Matchers<T = any> {
    toMatchAcrossRenderers(options?: ToMatchAcrossRenderersOptions): Promise<void>
  }
}
