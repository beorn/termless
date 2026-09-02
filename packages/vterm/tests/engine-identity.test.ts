import { existsSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
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
})
