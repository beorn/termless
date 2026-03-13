/**
 * Retry a block of assertions until they all pass or timeout.
 *
 * Like Playwright's `expect.poll()` but for assertion blocks.
 * All termless matchers work inside the block.
 *
 * ```typescript
 * // Retry until both assertions pass
 * await pollFor(() => {
 *   expect(term.screen).toContainText("ready")
 *   expect(term).toHaveCursorAt(0, 5)
 * })
 *
 * // With custom timeout and message
 * await pollFor(() => {
 *   expect(term.screen).toContainText("loaded")
 * }, { timeout: 10_000, message: "App should finish loading" })
 * ```
 *
 * For simple single-value checks, vitest's built-in `expect.poll` also works:
 * ```typescript
 * await expect.poll(() => term.screen.containsText("ready")).toBe(true)
 * ```
 *
 * And `expect.soft` works with all termless matchers for non-fatal assertions:
 * ```typescript
 * expect.soft(term.screen).toContainText("header")
 * expect.soft(term.screen).toContainText("footer")
 * ```
 */

export interface PollOptions {
  /** Maximum time to retry in milliseconds. Default: 5000. */
  timeout?: number
  /** Polling interval in milliseconds. Default: 50. */
  interval?: number
  /** Custom error context prepended to the failure message. */
  message?: string
}

let globalPollTimeout = 5_000
let globalPollInterval = 50

/**
 * Configure default timeout and interval for pollFor.
 */
export function configurePoll(options: PollOptions): void {
  if (options.timeout !== undefined) globalPollTimeout = options.timeout
  if (options.interval !== undefined) globalPollInterval = options.interval
}

/**
 * Retry a block of assertions until they all pass or timeout.
 *
 * Catches any assertion errors thrown by the block, waits `interval` ms,
 * then retries. On timeout, re-throws the last assertion error with
 * timing context appended.
 */
export async function pollFor(fn: () => void, options?: PollOptions): Promise<void> {
  const timeout = options?.timeout ?? globalPollTimeout
  const interval = options?.interval ?? globalPollInterval
  const message = options?.message

  const start = Date.now()
  let lastError: Error | undefined

  // First attempt
  try {
    fn()
    return // Passed on first try
  } catch (e) {
    lastError = e as Error
  }

  // Retry loop
  while (Date.now() - start < timeout) {
    await new Promise<void>((r) => setTimeout(r, interval))
    try {
      fn()
      return // Passed
    } catch (e) {
      lastError = e as Error
    }
  }

  // Timed out — re-throw with context
  const elapsed = Date.now() - start
  const prefix = message ? `${message}\n\n` : ""
  const suffix = `\n\n(pollFor retried for ${elapsed}ms, timed out after ${timeout}ms)`
  const error = new Error(`${prefix}${lastError!.message}${suffix}`)
  error.stack = lastError!.stack
  throw error
}
