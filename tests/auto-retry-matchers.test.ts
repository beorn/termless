/**
 * Tests for Playwright-style auto-retrying matchers.
 *
 * Like Playwright's `await expect(locator).toContainText('ready')`,
 * termless matchers auto-retry when awaited on terminal views.
 * The terminal view (term.screen, term.scrollback) is the "locator" —
 * a lazy evaluator that re-queries the terminal on each retry.
 *
 * ## Playwright comparison
 *
 * ```typescript
 * // Playwright: locator is lazy, assertion retries
 * await expect(page.locator('.status')).toContainText('ready')
 *
 * // Termless: terminal view is lazy, assertion retries
 * await expect(term.screen).toContainText('ready')
 * ```
 */
import { describe, test, expect } from "vitest"
import { createTerminal } from "../src/terminal.ts"
import { createXtermBackend } from "../packages/xtermjs/src/backend.ts"
import { configureTerminalMatchers } from "../packages/viterm/src/matchers.ts"
import "../packages/viterm/src/matchers.ts"

function createTerm(cols = 80, rows = 24) {
  return createTerminal({ backend: createXtermBackend(), cols, rows })
}

describe("auto-retrying matchers", () => {
  // ── Sync usage (existing behavior, backward compatible) ──

  test("toContainText passes immediately (sync)", () => {
    const term = createTerm()
    term.feed("Hello world")
    expect(term.screen).toContainText("Hello")
    term.close()
  })

  test("toContainText fails on non-retryable subject (sync)", () => {
    const term = createTerm()
    term.feed("Hello world")
    // On a plain string (non-retryable), failure is always sync
    const text = term.screen.getText()
    expect(() => {
      expect(text).toContain("Missing")
    }).toThrow(/Missing/)
    term.close()
  })

  test("toContainText returns Promise on retryable subject failure", () => {
    const term = createTerm()
    term.feed("Hello world")
    // On terminal views (retryable), failure returns a Promise for retry.
    // This matches Playwright: locator assertions must be awaited.
    const result = expect(term.screen).toContainText("Missing", { timeout: 50 })
    expect(result).toBeInstanceOf(Promise)
    // Consume the promise to avoid unhandled rejection
    ;(result as unknown as Promise<unknown>).catch(() => {})
    term.close()
  })

  test("cell matchers are always sync", () => {
    const term = createTerm()
    term.feed("\x1b[1mBold\x1b[0m Normal")
    expect(term.cell(0, 0)).toBeBold()
    expect(term.cell(0, 5)).not.toBeBold()
    term.close()
  })

  // ── Async usage (auto-retry, Playwright-style) ──

  test("toContainText retries until text appears", async () => {
    const term = createTerm()
    term.feed("Loading...")

    // Text appears after 100ms
    setTimeout(() => term.feed("\r\nReady!"), 100)

    // Without retry, this would fail. With await, it retries until "Ready!" appears.
    await expect(term.screen).toContainText("Ready!")
    await term.close()
  })

  test("toContainText times out with descriptive message", async () => {
    const term = createTerm()
    term.feed("Loading...")

    try {
      await expect(term.screen).toContainText("Never appears", { timeout: 200 })
      throw new Error("Should have thrown")
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain("Never appears")
      expect(msg).toContain("timed out")
    }
    await term.close()
  })

  test("toHaveText retries until exact match", async () => {
    const term = createTerm(20, 1)
    term.feed("old")

    setTimeout(() => {
      term.feed("\x1b[2J\x1b[H") // clear screen
      term.feed("new")
    }, 100)

    await expect(term.screen).toHaveText("new")
    await term.close()
  })

  test("toHaveCursorAt retries until cursor moves", async () => {
    const term = createTerm(20, 5)
    term.feed("Hello") // cursor at (5, 0)

    setTimeout(() => term.feed("\r\n"), 100) // move to (0, 1)

    await expect(term).toHaveCursorAt(0, 1)
    await term.close()
  })

  test("per-call timeout option", async () => {
    const term = createTerm()
    term.feed("Loading...")

    const start = Date.now()
    try {
      await expect(term.screen).toContainText("Never", { timeout: 150 })
    } catch {
      // Expected
    }
    const elapsed = Date.now() - start

    // Should have timed out around 150ms, not the default 5000ms
    expect(elapsed).toBeLessThan(500)
    await term.close()
  })

  test("configureTerminalMatchers sets global defaults", async () => {
    configureTerminalMatchers({ timeout: 150 })

    const term = createTerm()
    term.feed("Loading...")

    const start = Date.now()
    try {
      await expect(term.screen).toContainText("Never")
    } catch {
      // Expected
    }
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(500)

    // Reset
    configureTerminalMatchers({ timeout: 5000 })
    await term.close()
  })

  test("scrollback retries as content scrolls off", async () => {
    const term = createTerm(40, 3)

    // Fill screen: 3 lines, nothing in scrollback
    term.feed("line 1\r\nline 2\r\nline 3")
    expect(term.scrollback.getText()).not.toContain("line 1") // nothing scrolled yet

    // After delay, push content into scrollback
    setTimeout(() => term.feed("\r\nline 4\r\nline 5"), 100)

    // "line 1" should eventually appear in scrollback
    await expect(term.scrollback).toContainText("line 1")
    await term.close()
  })

  // ── Negation with auto-retry (Playwright-style .not) ──

  test("not.toContainText retries until text disappears", async () => {
    const term = createTerm(40, 3)
    term.feed("Loading...")

    // After 100ms, clear screen (text disappears)
    setTimeout(() => {
      term.feed("\x1b[2J\x1b[H") // clear
      term.feed("Done!")
    }, 100)

    // Should retry until "Loading..." is gone
    await expect(term.screen).not.toContainText("Loading...")
    await term.close()
  })

  test("not.toContainText passes immediately when text is absent", () => {
    const term = createTerm()
    term.feed("Hello world")
    // Text is already absent — passes sync (no await needed)
    expect(term.screen).not.toContainText("Missing")
    term.close()
  })
})
