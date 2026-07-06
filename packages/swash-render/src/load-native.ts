/**
 * The single native-addon load seam for @termless/swash-render.
 *
 * `createRequire` is kept here DELIBERATELY: the swash rasterizer ships as a
 * `.node` N-API native addon (local build, napi-rs platform-suffixed prebuild,
 * or optional platform package). A `.node` binary is a synchronous CommonJS
 * native module — it cannot be loaded through the ESM graph (`import()` /
 * `import.meta.resolve` don't handle `.node`), and it is not a node builtin (so
 * `process.getBuiltinModule` doesn't apply). createRequire is the correct and
 * only sync loader.
 *
 * Centralizing it here keeps @termless/swash-render at exactly ONE createRequire
 * site (this file), its sole entry on check-no-createrequire.sh.
 *
 * Bead: createrequire-ban (wave 3 — native-loader centralization).
 */
import { createRequire } from "node:module"

const nativeRequire = createRequire(import.meta.url)

/**
 * `require()` a native `.node` addon by path or specifier. Throws when the
 * binary is missing/incompatible — the caller walks a candidate list and
 * aggregates the errors into an actionable message.
 */
export function requireNativeAddon<T>(specifier: string): T {
  return nativeRequire(specifier) as T
}
