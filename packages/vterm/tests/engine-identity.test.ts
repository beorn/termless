/**
 * @failure Backend capabilities can report a stale package version instead of the loaded vterm.js engine.
 * @level l1
 * @consumer Termless backend identity and probe freshness
 * @testonly none
 * @reach fs-walk vendor/termless/packages/vterm/package.json
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { createVtermBackend } from "../src/backend.ts"
import { vtermEngineIdentity } from "../src/engine-identity.ts"

/** This package's own manifest: the engine dependency this package declares. */
const packageManifest = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")) as {
  dependencies?: Record<string, string>
}

describe("vtermEngineIdentity", () => {
  test("names the vterm.js that actually resolved: a semver version from a declared engine dependency", () => {
    const engine = vtermEngineIdentity()
    expect(engine.name).toBe("vterm.js")
    expect(engine.version).toMatch(/^\d+\.\d+\.\d+/)
    // The declaration is read from this repository, never from the resolved package's own manifest:
    // in the superproject that manifest is the sibling vterm checkout, which is not this package's to
    // reach (30050). The transitive read inside vtermEngineIdentity() -- which resolves the installed
    // engine and reads its manifest -- is the behavior under test here, not an edge this test adds.
    expect(packageManifest.dependencies?.["vterm.js"]).toBeDefined()
  })

  test("reports the loaded engine version through the production backend", () => {
    const engine = vtermEngineIdentity()
    expect(createVtermBackend().capabilities.version).toBe(engine.version)
  })
})
