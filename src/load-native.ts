/**
 * The single native / CommonJS-addon load seam for @termless/core.
 *
 * `createRequire` is kept here DELIBERATELY — these are the two cases the
 * ESM-only migration cannot convert, centralized so the package has exactly ONE
 * createRequire site (this file, the sole @termless/core entry on
 * check-no-createrequire.sh):
 *
 *  1. `loadNodePty()` — node-pty is a SYNCHRONOUS CommonJS native addon.
 *     `spawnPortablePty()` is a sync API, so the load must be sync; `await
 *     import()` is not an option and node-pty is not a node builtin (so
 *     `process.getBuiltinModule` doesn't apply either).
 *
 *  2. `resolveOptionalAsset()` — resolves an optional asset/module PATH (e.g.
 *     `@twemoji/svg/<key>.svg`) via Node resolution. The ESM equivalent
 *     `import.meta.resolve()` throws "not supported" under vitest's module
 *     runner — the environment these render paths are exercised in — so
 *     `require.resolve` is the only portable synchronous path resolver.
 *
 * Bead: createrequire-ban (wave 3 — native-loader centralization).
 */
import { createRequire } from "node:module"

const nativeRequire = createRequire(import.meta.url)

/** Minimal interface matching what we use from node-pty's IPty. */
export interface NodePtyInstance {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
  destroy(): void
  onData: (callback: (data: string) => void) => { dispose(): void }
  onExit: (callback: (e: { exitCode: number; signal?: number }) => void) => { dispose(): void }
  pid: number
}

/** Minimal interface for the node-pty module. */
export interface NodePtyModule {
  spawn(
    file: string,
    args: string[],
    options: {
      name?: string
      cols: number
      rows: number
      cwd?: string
      env?: Record<string, string>
    },
  ): NodePtyInstance
}

/**
 * Load node-pty synchronously. node-pty is a CommonJS native addon, so
 * createRequire is the correct way to load it from ESM and keep
 * `spawnPortablePty()` synchronous. Throws a clear, actionable error when the
 * optional peer is not installed.
 */
export function loadNodePty(): NodePtyModule {
  try {
    return nativeRequire("node-pty") as NodePtyModule
  } catch {
    throw new Error(
      "node-pty is required for PTY support on Node.js but was not found.\n" +
        "Install it with: npm install node-pty\n" +
        "Note: node-pty requires native compilation tools (Python, C++ compiler).",
    )
  }
}

/**
 * Resolve an optional asset/module path via Node resolution
 * (`require.resolve`). Throws when the specifier is not installed — callers
 * catch to soft-fall-back (e.g. Twemoji asset → font rendering).
 */
export function resolveOptionalAsset(specifier: string): string {
  return nativeRequire.resolve(specifier)
}
