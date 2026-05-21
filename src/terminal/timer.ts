/**
 * Mock timer system for testing terminal animations.
 *
 * Provides a controlled time source where pending timers fire synchronously
 * when advanceTime() is called. This allows deterministic testing of
 * animation frames, cursor blink, and other time-dependent behavior.
 */

// =============================================================================
// Types
// =============================================================================

/** A pending timer entry. */
interface PendingTimer {
  id: number
  callback: () => void
  fireAt: number
  interval: number | null // null = setTimeout, number = setInterval repeat
}

/** Mock timer controller for testing animations. */
export interface MockTimerController {
  /** Current mock time in milliseconds. */
  readonly now: number

  /**
   * Advance the mock clock by the given number of milliseconds.
   * All pending timers that fall within the window fire synchronously
   * in chronological order.
   */
  advanceTime(ms: number): void

  /** Schedule a one-shot timer (like setTimeout). Returns timer ID. */
  setTimeout(callback: () => void, delay: number): number

  /** Schedule a repeating timer (like setInterval). Returns timer ID. */
  setInterval(callback: () => void, interval: number): number

  /** Cancel a pending timer (like clearTimeout / clearInterval). */
  clearTimer(id: number): void

  /** Number of currently pending timers. */
  readonly pendingCount: number

  /** Dispose all pending timers. */
  dispose(): void
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a mock timer controller for testing animations.
 *
 * The controller manages its own clock that starts at 0 and only advances
 * when advanceTime() is called. Timers fire synchronously in order.
 *
 * @example
 * ```ts
 * const timer = createMockTimer()
 *
 * let fired = false
 * timer.setTimeout(() => { fired = true }, 100)
 *
 * timer.advanceTime(50)   // not yet
 * assert(!fired)
 *
 * timer.advanceTime(50)   // fires at t=100
 * assert(fired)
 *
 * timer.dispose()
 * ```
 */
export function createMockTimer(): MockTimerController {
  let currentTime = 0
  let nextId = 1
  const timers = new Map<number, PendingTimer>()

  function scheduleTimeout(callback: () => void, delay: number): number {
    const id = nextId++
    timers.set(id, {
      id,
      callback,
      fireAt: currentTime + Math.max(0, delay),
      interval: null,
    })
    return id
  }

  function scheduleInterval(callback: () => void, interval: number): number {
    const id = nextId++
    const safeInterval = Math.max(1, interval) // prevent zero-interval infinite loops
    timers.set(id, {
      id,
      callback,
      fireAt: currentTime + safeInterval,
      interval: safeInterval,
    })
    return id
  }

  function clearTimer(id: number): void {
    timers.delete(id)
  }

  function advanceTime(ms: number): void {
    if (ms < 0) throw new Error("Cannot advance time by a negative amount")

    const targetTime = currentTime + ms

    // Process timers in chronological order until we reach targetTime
    while (true) {
      // Find the next timer to fire
      let next: PendingTimer | null = null
      for (const timer of timers.values()) {
        if (timer.fireAt <= targetTime) {
          if (!next || timer.fireAt < next.fireAt || (timer.fireAt === next.fireAt && timer.id < next.id)) {
            next = timer
          }
        }
      }

      if (!next) break

      // Advance clock to timer fire time and execute
      currentTime = next.fireAt
      const { id, callback, interval } = next

      if (interval !== null) {
        // Reschedule interval timer for next occurrence
        next.fireAt = currentTime + interval
      } else {
        // One-shot: remove after firing
        timers.delete(id)
      }

      callback()
    }

    // Advance clock to the full target time
    currentTime = targetTime
  }

  return {
    get now() {
      return currentTime
    },

    advanceTime,
    setTimeout: scheduleTimeout,
    setInterval: scheduleInterval,
    clearTimer,

    get pendingCount() {
      return timers.size
    },

    dispose(): void {
      timers.clear()
    },
  }
}
