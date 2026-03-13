/**
 * Tests for new termless matchers: toHaveTextCount, toHaveVisibleText,
 * toHaveHiddenText, custom message option, and pollFor.
 */
import { describe, test, expect } from "vitest"
import { createTerminal } from "../src/terminal.ts"
import { createXtermBackend } from "../packages/xtermjs/src/backend.ts"
import { pollFor } from "../packages/viterm/src/poll.ts"
import "../packages/viterm/src/matchers.ts"

function createTerm(cols = 80, rows = 24) {
  return createTerminal({ backend: createXtermBackend(), cols, rows })
}

/** Helper: expect a matcher to fail (handles both sync throw and async rejection). */
async function expectToFail(fn: () => unknown, pattern?: RegExp): Promise<string> {
  try {
    const result = fn()
    if (result && typeof (result as Promise<unknown>).then === "function") {
      await result
    }
    throw new Error("Expected assertion to fail, but it passed")
  } catch (e) {
    const msg = (e as Error).message
    if (pattern) expect(msg).toMatch(pattern)
    return msg
  }
}

// ═══════════════════════════════════════════════════════
// toHaveTextCount
// ═══════════════════════════════════════════════════════

describe("toHaveTextCount", () => {
  test("sync pass: count matches", () => {
    const term = createTerm()
    term.feed("x y x z x")
    expect(term.screen).toHaveTextCount("x", 3)
    term.close()
  })

  test("sync fail: count does not match", async () => {
    const term = createTerm()
    term.feed("x y x z x")
    await expectToFail(
      () => expect(term.screen).toHaveTextCount("x", 5, { timeout: 0 }),
      /Expected "x" to appear 5 time\(s\), found 3/,
    )
    term.close()
  })

  test("auto-retry: count matches after delay", async () => {
    const term = createTerm()
    term.feed("x y x")
    // Initially 2 x's, need 3
    setTimeout(() => term.feed(" z x"), 100)
    await expect(term.screen).toHaveTextCount("x", 3)
    await term.close()
  })

  test(".not usage: count is not zero", () => {
    const term = createTerm()
    term.feed("x y x z x")
    expect(term.screen).not.toHaveTextCount("x", 0)
    term.close()
  })

  test(".not auto-retry: count changes away from target", async () => {
    const term = createTerm(40, 3)
    term.feed("x x x") // 3 x's
    // After delay, clear and write fewer x's
    setTimeout(() => {
      term.feed("\x1b[2J\x1b[H") // clear
      term.feed("x y")
    }, 100)
    await expect(term.screen).not.toHaveTextCount("x", 3)
    await term.close()
  })
})

// ═══════════════════════════════════════════════════════
// toHaveVisibleText
// ═══════════════════════════════════════════════════════

describe("toHaveVisibleText", () => {
  test("sync pass: text is on screen", () => {
    const term = createTerm()
    term.feed("Hello world")
    expect(term).toHaveVisibleText("Hello")
    term.close()
  })

  test("sync fail: text is not on screen", async () => {
    const term = createTerm()
    term.feed("Hello world")
    await expectToFail(
      () => expect(term).toHaveVisibleText("Missing", { timeout: 0 }),
      /Expected "Missing" to be visible on screen/,
    )
    term.close()
  })

  test("auto-retry: text appears after delay", async () => {
    const term = createTerm()
    term.feed("Loading...")
    setTimeout(() => term.feed("\r\nReady!"), 100)
    await expect(term).toHaveVisibleText("Ready!")
    await term.close()
  })

  test(".not negation: text is absent", () => {
    const term = createTerm()
    term.feed("Hello world")
    expect(term).not.toHaveVisibleText("Missing")
    term.close()
  })

  test(".not auto-retry: text disappears from screen", async () => {
    const term = createTerm(40, 3)
    term.feed("Loading...")
    setTimeout(() => {
      term.feed("\x1b[2J\x1b[H") // clear
      term.feed("Done!")
    }, 100)
    await expect(term).not.toHaveVisibleText("Loading...")
    await term.close()
  })
})

// ═══════════════════════════════════════════════════════
// toHaveHiddenText
// ═══════════════════════════════════════════════════════

describe("toHaveHiddenText", () => {
  test("sync pass: text is absent from screen", () => {
    const term = createTerm()
    term.feed("Hello world")
    expect(term).toHaveHiddenText("Missing")
    term.close()
  })

  test("sync fail: text IS visible on screen", async () => {
    const term = createTerm()
    term.feed("Hello world")
    await expectToFail(() => expect(term).toHaveHiddenText("Hello", { timeout: 0 }), /Expected "Hello" to be hidden/)
    term.close()
  })

  test("auto-retry: text scrolls off screen after delay", async () => {
    const term = createTerm(40, 3)
    // Fill screen with 3 lines including "first"
    term.feed("first\r\nsecond\r\nthird")
    // "first" is visible
    expect(term).toHaveVisibleText("first")

    // After delay, push "first" off screen into scrollback
    setTimeout(() => term.feed("\r\nfourth\r\nfifth\r\nsixth"), 100)

    // "first" should eventually be hidden (scrolled off)
    await expect(term).toHaveHiddenText("first")
    await term.close()
  })

  test(".not negation: text IS visible", () => {
    const term = createTerm()
    term.feed("Hello world")
    expect(term).not.toHaveHiddenText("Hello")
    term.close()
  })
})

// ═══════════════════════════════════════════════════════
// Custom message option
// ═══════════════════════════════════════════════════════

describe("custom message option", () => {
  test("toContainText with message: error includes custom context", async () => {
    const term = createTerm()
    term.feed("Hello")
    const msg = await expectToFail(() =>
      expect(term.screen).toContainText("missing", { timeout: 100, message: "App should load" }),
    )
    expect(msg).toContain("App should load")
    await term.close()
  })

  test("toHaveVisibleText with message: error includes custom context", async () => {
    const term = createTerm()
    term.feed("Hello")
    const msg = await expectToFail(() =>
      expect(term).toHaveVisibleText("missing", { timeout: 100, message: "Dashboard visible" }),
    )
    expect(msg).toContain("Dashboard visible")
    await term.close()
  })

  test("toHaveTextCount with message: error includes custom context", async () => {
    const term = createTerm()
    term.feed("x y x")
    const msg = await expectToFail(() =>
      expect(term.screen).toHaveTextCount("x", 10, { timeout: 100, message: "Expected many x's" }),
    )
    expect(msg).toContain("Expected many x's")
    await term.close()
  })
})

// ═══════════════════════════════════════════════════════
// pollFor
// ═══════════════════════════════════════════════════════

describe("pollFor", () => {
  test("passes immediately when assertions pass", async () => {
    const term = createTerm()
    term.feed("Hello world")
    // pollFor uses sync assertions — use getText() to avoid retryable Promise path
    await pollFor(() => {
      expect(term.screen.getText()).toContain("Hello")
    })
    term.close()
  })

  test("retries until block passes", async () => {
    const term = createTerm()
    term.feed("Loading...")
    setTimeout(() => term.feed("\r\nReady!"), 100)
    await pollFor(() => {
      expect(term.screen.getText()).toContain("Ready!")
    })
    await term.close()
  })

  test("times out with descriptive message", async () => {
    const term = createTerm()
    term.feed("Loading...")
    const msg = await expectToFail(
      () =>
        pollFor(
          () => {
            expect(term.screen.getText()).toContain("Never appears")
          },
          { timeout: 200 },
        ),
      /pollFor retried/,
    )
    expect(msg).toContain("timed out")
    await term.close()
  })

  test("custom message option appears in error", async () => {
    const term = createTerm()
    term.feed("Loading...")
    const msg = await expectToFail(() =>
      pollFor(
        () => {
          expect(term.screen.getText()).toContain("Never")
        },
        { timeout: 200, message: "Dashboard" },
      ),
    )
    expect(msg).toContain("Dashboard")
    await term.close()
  })

  test("multiple assertions in one block", async () => {
    const term = createTerm()
    term.feed("Loading...")

    setTimeout(() => {
      term.feed("\x1b[2J\x1b[H") // clear
      term.feed("Header\r\nContent\r\nFooter")
    }, 100)

    await pollFor(() => {
      expect(term.screen.getText()).toContain("Header")
      expect(term.screen.getText()).toContain("Content")
      expect(term.screen.getText()).toContain("Footer")
    })
    await term.close()
  })
})
