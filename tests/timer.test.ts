/**
 * Tests for the mock timer system.
 *
 * Verifies setTimeout, setInterval, advanceTime ordering, cancellation,
 * and edge cases (zero delay, negative time, dispose).
 */

import { describe, test, expect } from "vitest"
import { createMockTimer } from "../src/timer.ts"

// =============================================================================
// setTimeout
// =============================================================================

describe("MockTimerController - setTimeout", () => {
  test("timer does not fire before its delay", () => {
    const timer = createMockTimer()
    let fired = false
    timer.setTimeout(() => {
      fired = true
    }, 100)

    timer.advanceTime(99)
    expect(fired).toBe(false)

    timer.dispose()
  })

  test("timer fires exactly at its delay", () => {
    const timer = createMockTimer()
    let fired = false
    timer.setTimeout(() => {
      fired = true
    }, 100)

    timer.advanceTime(100)
    expect(fired).toBe(true)

    timer.dispose()
  })

  test("timer fires when advancing past its delay", () => {
    const timer = createMockTimer()
    let fired = false
    timer.setTimeout(() => {
      fired = true
    }, 50)

    timer.advanceTime(200)
    expect(fired).toBe(true)

    timer.dispose()
  })

  test("multiple timers fire in chronological order", () => {
    const timer = createMockTimer()
    const order: number[] = []

    timer.setTimeout(() => order.push(2), 200)
    timer.setTimeout(() => order.push(1), 100)
    timer.setTimeout(() => order.push(3), 300)

    timer.advanceTime(300)
    expect(order).toEqual([1, 2, 3])

    timer.dispose()
  })

  test("timer fires only once", () => {
    const timer = createMockTimer()
    let count = 0
    timer.setTimeout(() => {
      count++
    }, 100)

    timer.advanceTime(100)
    timer.advanceTime(100)
    timer.advanceTime(100)
    expect(count).toBe(1)

    timer.dispose()
  })

  test("zero-delay timer fires immediately on next advance", () => {
    const timer = createMockTimer()
    let fired = false
    timer.setTimeout(() => {
      fired = true
    }, 0)

    timer.advanceTime(0)
    expect(fired).toBe(true)

    timer.dispose()
  })

  test("now reflects current mock time", () => {
    const timer = createMockTimer()
    expect(timer.now).toBe(0)

    timer.advanceTime(150)
    expect(timer.now).toBe(150)

    timer.advanceTime(50)
    expect(timer.now).toBe(200)

    timer.dispose()
  })
})

// =============================================================================
// setInterval
// =============================================================================

describe("MockTimerController - setInterval", () => {
  test("interval fires repeatedly", () => {
    const timer = createMockTimer()
    let count = 0
    timer.setInterval(() => {
      count++
    }, 100)

    timer.advanceTime(350)
    expect(count).toBe(3) // fires at 100, 200, 300

    timer.dispose()
  })

  test("interval does not fire before first occurrence", () => {
    const timer = createMockTimer()
    let count = 0
    timer.setInterval(() => {
      count++
    }, 100)

    timer.advanceTime(50)
    expect(count).toBe(0)

    timer.dispose()
  })

  test("interval fires exactly at boundaries", () => {
    const timer = createMockTimer()
    let count = 0
    timer.setInterval(() => {
      count++
    }, 100)

    timer.advanceTime(100)
    expect(count).toBe(1)

    timer.advanceTime(100)
    expect(count).toBe(2)

    timer.dispose()
  })
})

// =============================================================================
// clearTimer
// =============================================================================

describe("MockTimerController - clearTimer", () => {
  test("cancels a pending setTimeout", () => {
    const timer = createMockTimer()
    let fired = false
    const id = timer.setTimeout(() => {
      fired = true
    }, 100)

    timer.clearTimer(id)
    timer.advanceTime(200)
    expect(fired).toBe(false)

    timer.dispose()
  })

  test("cancels a pending setInterval", () => {
    const timer = createMockTimer()
    let count = 0
    const id = timer.setInterval(() => {
      count++
    }, 100)

    timer.advanceTime(150) // fires once at 100
    expect(count).toBe(1)

    timer.clearTimer(id)
    timer.advanceTime(200) // would have fired at 200 and 300
    expect(count).toBe(1)

    timer.dispose()
  })

  test("clearing a non-existent timer is safe", () => {
    const timer = createMockTimer()
    expect(() => timer.clearTimer(999)).not.toThrow()
    timer.dispose()
  })
})

// =============================================================================
// Edge Cases
// =============================================================================

describe("MockTimerController - edge cases", () => {
  test("negative advanceTime throws", () => {
    const timer = createMockTimer()
    expect(() => timer.advanceTime(-10)).toThrow("Cannot advance time by a negative amount")
    timer.dispose()
  })

  test("pendingCount tracks active timers", () => {
    const timer = createMockTimer()
    expect(timer.pendingCount).toBe(0)

    const id1 = timer.setTimeout(() => {}, 100)
    expect(timer.pendingCount).toBe(1)

    timer.setTimeout(() => {}, 200)
    expect(timer.pendingCount).toBe(2)

    timer.clearTimer(id1)
    expect(timer.pendingCount).toBe(1)

    timer.advanceTime(300)
    expect(timer.pendingCount).toBe(0)

    timer.dispose()
  })

  test("dispose clears all pending timers", () => {
    const timer = createMockTimer()
    timer.setTimeout(() => {}, 100)
    timer.setInterval(() => {}, 50)
    expect(timer.pendingCount).toBe(2)

    timer.dispose()
    expect(timer.pendingCount).toBe(0)
  })

  test("timer scheduled inside a timer callback fires in the same advance", () => {
    const timer = createMockTimer()
    const order: number[] = []

    timer.setTimeout(() => {
      order.push(1)
      // Schedule another timer 50ms from now (t=100), so it fires at t=150
      timer.setTimeout(() => {
        order.push(2)
      }, 50)
    }, 100)

    timer.advanceTime(200)
    expect(order).toEqual([1, 2])

    timer.dispose()
  })

  test("same-time timers fire in registration order", () => {
    const timer = createMockTimer()
    const order: number[] = []

    timer.setTimeout(() => order.push(1), 100)
    timer.setTimeout(() => order.push(2), 100)
    timer.setTimeout(() => order.push(3), 100)

    timer.advanceTime(100)
    expect(order).toEqual([1, 2, 3])

    timer.dispose()
  })

  test("advanceTime(0) with no timers is a no-op", () => {
    const timer = createMockTimer()
    expect(() => timer.advanceTime(0)).not.toThrow()
    expect(timer.now).toBe(0)
    timer.dispose()
  })
})
