import { describe, expect, it } from "vitest"
import { Command } from "@silvery/commander"

// Polyfill AsyncDisposableStack for standalone Node 22 vitest runner
if (typeof (globalThis as { AsyncDisposableStack?: unknown }).AsyncDisposableStack === "undefined") {
  const asyncDispose: symbol = (Symbol as { asyncDispose?: symbol }).asyncDispose ?? Symbol.for("Symbol.asyncDispose")
  ;(Symbol as { asyncDispose?: symbol }).asyncDispose ??= asyncDispose
  class AsyncDisposableStackPolyfill {
    #disposed = false
    #stack: Array<() => unknown | Promise<unknown>> = []
    get disposed(): boolean {
      return this.#disposed
    }
    defer(fn: () => unknown | Promise<unknown>): void {
      if (this.#disposed) throw new ReferenceError("disposed")
      this.#stack.push(fn)
    }
    use<T>(v: T): T {
      return v
    }
    adopt<T>(v: T, fn: (v: T) => unknown | Promise<unknown>): T {
      this.defer(() => fn(v))
      return v
    }
    async disposeAsync(): Promise<void> {
      if (this.#disposed) return
      this.#disposed = true
      for (let i = this.#stack.length - 1; i >= 0; i--) await this.#stack[i]!()
    }
    [asyncDispose](): Promise<void> {
      return this.disposeAsync()
    }
  }
  ;(globalThis as { AsyncDisposableStack?: unknown }).AsyncDisposableStack = AsyncDisposableStackPolyfill
}

const { registerBackendCommand } = await import("../src/backend-cmd.tsx")

describe("termless backends update --apply wiring (25141 item 1)", () => {
  it("passes apply: true to updateAction when --apply flag is given", async () => {
    const receivedOpts: Array<{ apply?: boolean }> = []
    const program = new Command()
    registerBackendCommand(program, {
      updateAction: async (opts) => {
        receivedOpts.push(opts)
      },
    })

    await program.parseAsync(["node", "termless", "backends", "update", "--apply"])

    expect(receivedOpts).toHaveLength(1)
    expect(receivedOpts[0]?.apply).toBe(true)
  })

  it("passes apply as undefined when --apply flag is omitted", async () => {
    const receivedOpts: Array<{ apply?: boolean }> = []
    const program = new Command()
    registerBackendCommand(program, {
      updateAction: async (opts) => {
        receivedOpts.push(opts)
      },
    })

    await program.parseAsync(["node", "termless", "backends", "update"])

    expect(receivedOpts).toHaveLength(1)
    expect(receivedOpts[0]?.apply).toBeUndefined()
  })
})
