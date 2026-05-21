/**
 * Side-effect polyfill for `AsyncDisposableStack`.
 *
 * Node 22 (vitest's default runtime) ships without it; silvery's
 * `@silvery/scope` package extends it. A minimal stub is enough to satisfy
 * the module-load `class X extends ...` check during ESM evaluation.
 * Bun's runtime has it natively — this file is a no-op there.
 *
 * Import this module BEFORE any silvery import so the stub is installed
 * before `@silvery/scope` evaluates its `extends` clause.
 */

if (typeof (globalThis as { AsyncDisposableStack?: unknown }).AsyncDisposableStack === "undefined") {
  class StubAsyncDisposableStack {
    disposed = false
    async [Symbol.asyncDispose](): Promise<void> {
      this.disposed = true
    }
    use<T>(value: T): T {
      return value
    }
    adopt<T>(value: T, _onDispose: (value: T) => void | Promise<void>): T {
      return value
    }
    defer(_onDispose: () => void | Promise<void>): void {}
    move(): StubAsyncDisposableStack {
      return new StubAsyncDisposableStack()
    }
    async disposeAsync(): Promise<void> {
      this.disposed = true
    }
  }
  ;(globalThis as unknown as { AsyncDisposableStack: typeof StubAsyncDisposableStack }).AsyncDisposableStack =
    StubAsyncDisposableStack
}
