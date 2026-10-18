/**
 * @failure Backend capabilities can report a stale package version instead of the loaded vterm.js engine.
 * @level l1
 * @consumer Termless backend identity and probe freshness
 * @testonly none
 * @reach fs-walk packages/vterm/package.json
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { createVtermBackend } from "../src/backend.ts"
import { vtermEngineIdentity } from "../src/engine-identity.ts"

/** This package's own manifest: the declared engine dependency the resolved version must stay on. */
const packageManifest = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")) as {
  dependencies?: Record<string, string>
}

describe("vtermEngineIdentity", () => {
  test("names the vterm.js that actually resolved, on the dependency line this package declares", () => {
    const engine = vtermEngineIdentity()
    expect(engine.name).toBe("vterm.js")
    expect(engine.version).toMatch(/^\d+\.\d+\.\d+/)
    // Read from this repository, never the resolved package's own manifest: in the superproject that
    // manifest is the sibling vterm checkout, which is not this package's to reach (30050).
    const declared = packageManifest.dependencies?.["vterm.js"]
    if (declared === undefined) throw new Error("packages/vterm/package.json declares no vterm.js dependency")
    // The caret in this repo is on 0.x, where it pins the minor (^0.7.0 admits 0.7.x only).
    const [major, minor] = declared.replace(/^[^\d]*/, "").split(".")
    expect(engine.version.split(".").slice(0, 2)).toEqual([major, minor])
  })

  test("reports the loaded engine version through the production backend", () => {
    const engine = vtermEngineIdentity()
    expect(createVtermBackend().capabilities.version).toBe(engine.version)
  })
})
