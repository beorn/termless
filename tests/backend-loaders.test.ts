/**
 * @failure A backend named in backends.json has no literal loader (or a loader has no manifest entry), so the
 *          km-daemon closure digest silently misses that backend and a change to it never restarts km
 *          (27837, @cto 26cf4eaa). The literal per-backend import map is what lets the closure follow every backend;
 *          a name in one list but not the other would silently hide a backend from the graph.
 * @level l2 - the real backends.json read beside the real loader map
 * @consumer @ag/hab/27754-assignment-unmanned-pages-a-working-seat-during-the-tribe-restart-a-landing-promotion-causes/27837-promotion-restarts-wire-unchanged
 * @reach fs-walk <fixture-only: reads backends.json beside the module, no source-tree walk>
 * @testonly none
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { backendLoaders } from "../src/backend/backend-loaders.ts"

interface Manifest {
  backends: Record<string, { package: string }>
}

describe("backendLoaders matches backends.json", () => {
  test("the loader map and the manifest name the same packages", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..")
    const manifest = JSON.parse(readFileSync(join(root, "backends.json"), "utf8")) as Manifest
    const declared = Object.values(manifest.backends)
      .map((entry) => entry.package)
      .sort()
    expect(Object.keys(backendLoaders).sort()).toEqual(declared)
  })
})
