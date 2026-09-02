/**
 * Which vterm.js this backend is actually running on.
 *
 * `import "vterm.js"` resolves to whatever the install put there: the
 * published package in a fresh clone or CI, a workspace `file:` override in
 * the hh superproject. Both are legitimate, and nothing else in the process
 * says which one won — so a green corpus run in one world was accepted as a
 * fact about the other (@i/27-unterm/engine-convergence). The ledger check and
 * every vterm failure text name the engine through this function.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export interface VtermEngineIdentity {
  readonly name: "vterm.js"
  /** The manifest version of the package that resolved. */
  readonly version: string
  /**
   * Real path of the resolved package directory, symlinks followed — the
   * world it came from (a published tarball unpacked under node_modules, or
   * a workspace override whose real path names the source checkout).
   */
  readonly location: string
}

/**
 * Locate the `vterm.js` package the way a bare `import "vterm.js"` from this
 * module does — the nearest `node_modules/vterm.js` walking up from here — and
 * read its manifest.
 *
 * The manifest is read directly rather than resolved: the package's exports
 * map exposes only its entry (a `require.resolve` of the manifest is refused
 * on the published package), and the test harness's module runner has no
 * `import.meta.resolve`. Throws when no candidate exists (the backend could
 * not be importing the engine either) or when the manifest found is not
 * vterm.js's: a mis-linked install must fail here, not produce a grade that
 * names the wrong engine.
 */
export function vtermEngineIdentity(): VtermEngineIdentity {
  const start = dirname(fileURLToPath(import.meta.url))
  let dir = start
  for (;;) {
    const manifestPath = join(dir, "node_modules", "vterm.js", "package.json")
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: unknown; version?: unknown }
      if (manifest.name !== "vterm.js" || typeof manifest.version !== "string") {
        throw new Error(
          `vtermEngineIdentity: ${manifestPath} names ${JSON.stringify(manifest.name)}@${JSON.stringify(manifest.version)}, not vterm.js`,
        )
      }
      return { name: "vterm.js", version: manifest.version, location: realpathSync(dirname(manifestPath)) }
    }
    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error(
        `vtermEngineIdentity: no node_modules/vterm.js/package.json in any directory above ${start} — ` +
          `the vterm backend cannot be importing its engine from here, so the install is broken`,
      )
    }
    dir = parent
  }
}
