/**
 * The single asset-resolution seam for @termless/ghostty.
 *
 * `createRequire` is kept here DELIBERATELY: it resolves the ghostty-web WASM
 * asset PATH via Node resolution. The ESM equivalent `import.meta.resolve()`
 * throws "not supported" under vitest's module runner — the environment this
 * render path is exercised in — so `require.resolve` is the only portable
 * synchronous path resolver. The WASM module itself is then loaded through the
 * ESM graph (`await import`) by the caller, never here.
 *
 * Centralizing the resolve here keeps @termless/ghostty at exactly ONE
 * createRequire site (this file), its sole entry on check-no-createrequire.sh.
 *
 * Bead: createrequire-ban (wave 3 — native-loader centralization).
 */
import { createRequire } from "node:module"

const nativeRequire = createRequire(import.meta.url)

/**
 * Resolve the absolute path of ghostty-web's always-exported `ghostty-vt.wasm`
 * asset. Callers walk up from this to the package root to find the ESM entry.
 * Throws when ghostty-web is not installed.
 */
export function resolveGhosttyWebWasm(): string {
  return nativeRequire.resolve("ghostty-web/ghostty-vt.wasm")
}
