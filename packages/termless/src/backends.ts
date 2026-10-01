/**
 * `termless/backends` — the ONLY home of plurality.
 *
 * Every other subpath (`.`, `./fmt`, `./rec`, `./contract`) is engine-agnostic
 * by construction: nothing there can name, select, or install a specific
 * terminal emulator. This is where "which engine" becomes a question you can
 * ask. Teaching line: if you never import `termless/backends`, you never have
 * more than one engine.
 *
 * ```typescript
 * import { backend } from "termless/backends"
 *
 * const b = await backend("vterm")
 * // A different release is refused; install the desired release through a supported package setup.
 * ```
 */

export { backend, backends, buildBackend, createTerminalByName, entry, isReady, manifest } from "@termless/core"

export type { BackendEntry, Manifest, ResolveOptions } from "@termless/core"
