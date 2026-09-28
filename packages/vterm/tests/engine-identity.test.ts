/**
 * @failure Backend capabilities can report a stale package version instead of the loaded vterm.js engine.
 * @level l1
 * @consumer Termless backend identity and probe freshness
 * @testonly none
 * @reach fs-walk vendor/termless/packages/vterm/node_modules/vterm.js/package.json vendor/vterm/packages/vterm/package.json
 */
import { existsSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { createVtermBackend } from "../src/backend.ts"
import { vtermEngineIdentity } from "../src/engine-identity.ts"

describe("vtermEngineIdentity", () => {
  test("names the vterm.js that actually resolved: a semver version and a real package directory", () => {
    const engine = vtermEngineIdentity()
    expect(engine.name).toBe("vterm.js")
    expect(engine.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(existsSync(join(engine.location, "package.json")), `no manifest at ${engine.location}`).toBe(true)
    // The real path keeps the package name in either world: an unpacked
    // tarball under node_modules, or a workspace override whose copy is
    // named for the package.
    expect(engine.location).toContain("vterm.js")
  })

  test("reports the loaded engine version through the production backend", () => {
    const engine = vtermEngineIdentity()
    expect(createVtermBackend().capabilities.version).toBe(engine.version)
  })
})
